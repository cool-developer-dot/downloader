/**
 * F14: the engines behind Hamza's Storage page (F9). Contract (agreed 2026-11-26): findDuplicates, planOneTapClean,
 * runClean, getLowSpaceSettings, setLowSpaceSettings, useLowSpace. Nothing here deletes a library file: duplicates
 * are only found (the screen sends the chosen copies to the bin), and a clean frees cache, temporary files,
 * leftover download parts and bin items whose keep time is over.
 */
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { persist } from 'zustand/middleware';

import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { fileIntegrity } from '@/downloads/v2/file-integrity';
import { activeLegacyIds } from '@/downloads/v2/leftovers-policy';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { getLibrary } from '@/library';
import { clearVidoraXCache, readDeviceStorageSnapshot, scanAppStorageAsync } from '@/storage-manager';
import { mmkvKeys } from '@/storage/constants';
import { useDownloadsStore } from '@/store/downloads';
import { createStore } from '@/store/shared/create-store';
import { createPersistStorage } from '@/store/shared/persist-storage';

import type { FileEntry } from '../api';
import { fileTypeOf } from '../engine/file-types';
import { expiredEntries } from '../trash/bin-model';
import { useBinStore } from '../trash/bin-store';
import { purgeExpiredBin } from '../trash/trash-api';
import {
  buildCleanPlan,
  dayKey,
  DEFAULT_LOW_SPACE,
  groupsFromHashes,
  lowSpaceDecision,
  normalizeLowSpaceSettings,
  sizeCandidates,
  type CleanPlan,
  type LowSpaceSettings,
} from './cleanup-model';

// ---- #819 Find duplicates ----------------------------------------------------------------------------------------

function abortError(): Error {
  const error = new Error('Duplicate scan cancelled');
  error.name = 'AbortError';
  return error;
}

/**
 * Same-content library items, in groups of two or more (newest copy first). Only files whose size matches another's
 * are hashed (SHA-256, stored by the engine, so a second scan is instant). Trashed items are never included (the
 * library leaves them out), Private files are not in the library. `signal` stops it (rejects with AbortError).
 */
export async function findDuplicates(opts?: {
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<{ hash: string; items: FileEntry[] }[]> {
  const port = fileIntegrity();
  const { items } = await getLibrary();
  const present = items.filter((item) => item.localAvailability === 'available');
  const candidates = sizeCandidates(present).flat();
  const hashes = new Map<string, string>();
  opts?.onProgress?.(0, candidates.length);
  if (!port?.computeChecksum) {
    return [];
  }
  let done = 0;
  for (const id of candidates) {
    if (opts?.signal?.aborted) {
      throw abortError();
    }
    const onAbort = () => port.cancelChecksum?.(id);
    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const hash = await port.computeChecksum(id).catch(() => null);
      if (hash) {
        hashes.set(id, hash);
      }
    } finally {
      opts?.signal?.removeEventListener('abort', onAbort);
    }
    if (opts?.signal?.aborted) {
      throw abortError();
    }
    done += 1;
    opts?.onProgress?.(done, candidates.length);
  }
  const entries: FileEntry[] = present.map((item) => ({ ...item, fileType: fileTypeOf(item.mimeType, item.fileName) }));
  return groupsFromHashes(entries, hashes);
}

// ---- #853 One-tap clean (with #852's leftover download files) ------------------------------------------------------

type TempPort = { getStorageStats(): Promise<{ tempBytes: number }>; clearTempFiles(): Promise<number> };

function tempPort(): TempPort | null {
  if (!isVidoraMediaAvailable()) {
    return null;
  }
  const media = getVidoraMedia() as unknown as Partial<TempPort>;
  return typeof media.getStorageStats === 'function' && typeof media.clearTempFiles === 'function' ? (media as TempPort) : null;
}

function leftoverOptions(): { keepLegacyIds: string[] } {
  return { keepLegacyIds: activeLegacyIds(useDownloadsStore.getState().itemsById) };
}

/** What a one-tap clean would free now. Library files are never part of it. */
export async function planOneTapClean(): Promise<CleanPlan> {
  const engine = getV2Engine();
  const temp = tempPort();
  const { entries, settings } = useBinStore.getState();
  const [app, leftovers, stats] = await Promise.all([
    scanAppStorageAsync().catch(() => null),
    engine?.measureLeftoverFiles?.(leftoverOptions()).catch(() => null) ?? Promise.resolve(null),
    temp?.getStorageStats().catch(() => null) ?? Promise.resolve(null),
  ]);
  return buildCleanPlan({
    cacheBytes: app?.cacheBytes ?? 0,
    leftoverBytes: leftovers?.bytes ?? 0,
    tempBytes: stats?.tempBytes ?? 0,
    binExpiredBytes: expiredEntries(entries, settings.keepDays, Date.now()).reduce((sum, e) => sum + e.sizeBytes, 0),
  });
}

/** Runs the clean. `freedBytes` is what each step reports it freed (the plan's numbers are what to expect). */
export async function runClean(plan: CleanPlan): Promise<{ freedBytes: number }> {
  let freed = 0;
  if (plan.cacheBytes > 0) {
    freed += await clearVidoraXCache().then((r) => r.clearedBytes).catch(() => 0);
  }
  const temp = tempPort();
  if (plan.tempBytes > 0 && temp) {
    freed += await temp.clearTempFiles().catch(() => 0);
  }
  const engine = getV2Engine();
  if (plan.leftoverBytes > 0 && engine?.cleanLeftoverFiles) {
    freed += await engine.cleanLeftoverFiles(leftoverOptions()).then((r) => r.bytes).catch(() => 0);
  }
  if (plan.binExpiredBytes > 0) {
    const before = useBinStore.getState().entries;
    const purged = await purgeExpiredBin().catch(() => [] as string[]);
    freed += purged.reduce((sum, id) => sum + (before[id]?.sizeBytes ?? 0), 0);
  }
  return { freedBytes: freed };
}

// ---- #855 Low space alert ----------------------------------------------------------------------------------------

type LowSpaceState = LowSpaceSettings & { lastAlertDay: string | null };

const useLowSpaceStore = createStore<LowSpaceState>()(
  persist((): LowSpaceState => ({ ...DEFAULT_LOW_SPACE, lastAlertDay: null }), {
    name: mmkvKeys.filesLowSpace,
    storage: createPersistStorage<LowSpaceState>(),
    merge: (persisted, current) => {
      const value = (persisted ?? {}) as Partial<LowSpaceState>;
      return {
        ...current,
        ...normalizeLowSpaceSettings(value),
        lastAlertDay: typeof value.lastAlertDay === 'string' ? value.lastAlertDay : null,
      };
    },
  }),
);

export function getLowSpaceSettings(): LowSpaceSettings {
  const { enabled, thresholdBytes } = useLowSpaceStore.getState();
  return { enabled, thresholdBytes };
}

export function setLowSpaceSettings(patch: Partial<LowSpaceSettings>): void {
  useLowSpaceStore.setState((state) => normalizeLowSpaceSettings({ enabled: state.enabled, thresholdBytes: state.thresholdBytes, ...patch }));
}

const CHANNEL_ID = 'vidorax_low_space';

async function notifyLowSpace(freeBytes: number): Promise<void> {
  const [Notifications, { translate }, { useSettingsStore }, { formatBytesLabel }] = await Promise.all([
    import('expo-notifications'),
    import('@/localization'),
    import('@/store/settings'),
    import('@/storage-manager'),
  ]);
  if (useSettingsStore.getState().notifications === false) {
    return;
  }
  const permission = await Notifications.getPermissionsAsync().catch(() => null);
  if (!permission?.granted) {
    return;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: translate('filesCore.lowSpaceChannel'),
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: false,
      showBadge: false,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: translate('filesCore.lowSpaceTitle'),
      body: translate('filesCore.lowSpaceBody', { free: formatBytesLabel(Math.max(0, Math.floor(freeBytes))) ?? '' }),
      sound: false,
      data: { openStorage: true },
    },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
  }).catch(() => undefined);
}

/**
 * Checks free space (app start, resume, before each download starts). Sends at most one notification a day while
 * space is under the limit, and never when the alert is off. Returns whether space is low.
 */
export async function checkLowSpace(nowMs = Date.now()): Promise<boolean> {
  const state = useLowSpaceStore.getState();
  const freeBytes = readDeviceStorageSnapshot().freeBytes;
  const decision = lowSpaceDecision({ settings: state, freeBytes, lastAlertDay: state.lastAlertDay, nowMs });
  if (decision.notify && freeBytes != null) {
    useLowSpaceStore.setState({ lastAlertDay: dayKey(nowMs) });
    await notifyLowSpace(freeBytes).catch(() => undefined);
  }
  return decision.low;
}

/** For the in-app banner (F9): rechecked every minute and when the app comes back. */
export function useLowSpace(): { low: boolean; freeBytes: number; thresholdBytes: number } {
  const settings = useLowSpaceStore((state) => state);
  const [freeBytes, setFreeBytes] = useState<number | null>(() => readDeviceStorageSnapshot().freeBytes);
  useEffect(() => {
    const read = () => setFreeBytes(readDeviceStorageSnapshot().freeBytes);
    const timer = setInterval(read, 60_000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        read();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  // `nowMs` only matters for the daily notification, which the banner does not send.
  const { low } = lowSpaceDecision({ settings, freeBytes, lastAlertDay: null, nowMs: 0 });
  return { low, freeBytes: freeBytes ?? 0, thresholdBytes: settings.thresholdBytes };
}

const WATCH_SLOT = '__vidoraxLowSpaceWatch';

/** Startup (src/bootstrap/app-initializer.ts): checks now and each time the app comes back to the front. */
export function ensureLowSpaceWatch(): void {
  const slot = globalThis as unknown as Record<string, { remove(): void } | undefined>;
  slot[WATCH_SLOT]?.remove();
  slot[WATCH_SLOT] = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      void checkLowSpace().catch(() => undefined);
    }
  });
  void checkLowSpace().catch(() => undefined);
}
