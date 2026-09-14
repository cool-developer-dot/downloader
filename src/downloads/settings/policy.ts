/**
 * Engine-readable download policy accessors.
 * Must NOT import Settings screens or UI components.
 */

import { useSettingsStore } from '@/store/settings';

import { normalizeDownloadSettings, normalizeMaxConcurrentDownloads } from './normalize';
import {
  readExplicitDownloadBooleans,
  readExplicitMaxConcurrentDownloads,
  readPersistedDownloadSettings,
  writePersistedDownloadSettings,
} from './persist';
import {
  DEFAULT_DOWNLOAD_SETTINGS,
  type DownloadSettings,
} from './types';

let hydrated = false;

type DownloadSettingsListener = (settings: DownloadSettings) => void;
const settingsListeners = new Set<DownloadSettingsListener>();

function notifySettingsListeners(settings: DownloadSettings): void {
  for (const listener of settingsListeners) {
    try {
      listener(settings);
    } catch {
      // never break writers
    }
  }
}

/**
 * Subscribe to wifiOnly / maxConcurrentDownloads policy changes.
 * Engine lifetime — not screen lifetime.
 */
export function subscribeDownloadSettings(
  listener: DownloadSettingsListener,
): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

/**
 * Ensure Zustand settings store includes normalized download fields from disk.
 * Does not clear unrelated storage. Safe to call multiple times.
 *
 * Explicit MMKV keys / envelope win when present. Missing keys (or Expo Go
 * without MMKV) keep the live Zustand value — never force product defaults
 * over a persisted `false`.
 */
export function hydrateDownloadSettings(): DownloadSettings {
  const explicit = readExplicitDownloadBooleans();
  const explicitMax = readExplicitMaxConcurrentDownloads();

  try {
    const store = useSettingsStore.getState();

    if (explicit.wifiOnly !== null) {
      applyStoreField(store, 'wifiOnly', explicit.wifiOnly);
    }
    if (explicit.autoResume !== null) {
      applyStoreField(store, 'autoResume', explicit.autoResume);
    }
    if (explicit.notificationsEnabled !== null) {
      applyStoreField(store, 'notifications', explicit.notificationsEnabled);
    }
    if (explicitMax !== null) {
      applyStoreField(store, 'maxConcurrentDownloads', explicitMax);
    } else {
      applyStoreField(
        store,
        'maxConcurrentDownloads',
        normalizeMaxConcurrentDownloads(store.maxConcurrentDownloads),
      );
    }
  } catch {
    // Store unavailable — disk snapshot is enough for engine readers.
  }

  hydrated = true;
  const result = getDownloadSettings();
  notifySettingsListeners(result);
  return result;
}

function applyStoreField<K extends 'wifiOnly' | 'autoResume' | 'notifications' | 'maxConcurrentDownloads'>(
  store: ReturnType<typeof useSettingsStore.getState>,
  key: K,
  value: ReturnType<typeof useSettingsStore.getState>[K],
): void {
  if (store[key] === value) {
    return;
  }
  store.updateSetting(key, value);
}

/**
 * Push current store download fields to MMKV envelope + engine listeners.
 * Use after store mutations that bypass setDownloadSettings (API hydrate / rollback).
 */
export function publishDownloadSettingsFromStore(): DownloadSettings {
  const settings = getDownloadSettings();
  const explicitMax = readExplicitMaxConcurrentDownloads();
  const fromStore = normalizeMaxConcurrentDownloads(
    settings.maxConcurrentDownloads,
  );
  const maxConcurrentDownloads =
    explicitMax != null &&
    fromStore === DEFAULT_DOWNLOAD_SETTINGS.maxConcurrentDownloads &&
    explicitMax !== fromStore
      ? explicitMax
      : fromStore;

  const next = {
    ...settings,
    maxConcurrentDownloads,
  };
  writePersistedDownloadSettings(next);
  hydrated = true;
  notifySettingsListeners(next);
  return next;
}

export function isDownloadSettingsHydrated(): boolean {
  return hydrated;
}

/**
 * Canonical read path for engine / recovery / Day 2.
 * Prefers live settings store when available; always normalizes.
 */
export function getDownloadSettings(): DownloadSettings {
  try {
    const state = useSettingsStore.getState();
    return normalizeDownloadSettings({
      wifiOnly: state.wifiOnly,
      autoResume: state.autoResume,
      notificationsEnabled: state.notifications,
      maxConcurrentDownloads: state.maxConcurrentDownloads,
    });
  } catch {
    return readPersistedDownloadSettings();
  }
}

/**
 * Snapshot used by persistence helpers when MMKV keys are absent.
 */
export function getLiveDownloadSettingsFallback(): Partial<DownloadSettings> {
  try {
    const state = useSettingsStore.getState();
    return {
      wifiOnly: state.wifiOnly,
      autoResume: state.autoResume,
      notificationsEnabled: state.notifications,
      maxConcurrentDownloads: state.maxConcurrentDownloads,
    };
  } catch {
    return {};
  }
}

export function setDownloadSettings(next: DownloadSettings): DownloadSettings {
  const normalized = normalizeDownloadSettings(next);
  writePersistedDownloadSettings(normalized);

  try {
    const store = useSettingsStore.getState();
    store.updateSetting('wifiOnly', normalized.wifiOnly);
    store.updateSetting('autoResume', normalized.autoResume);
    store.updateSetting('notifications', normalized.notificationsEnabled);
    store.updateSetting('maxConcurrentDownloads', normalized.maxConcurrentDownloads);
  } catch {
    // Persist already succeeded.
  }

  hydrated = true;
  notifySettingsListeners(normalized);
  return normalized;
}

export function updateDownloadSettings(
  patch: Partial<DownloadSettings>,
): DownloadSettings {
  return setDownloadSettings({
    ...getDownloadSettings(),
    ...patch,
  });
}

export function isWifiOnlyEnabled(): boolean {
  return getDownloadSettings().wifiOnly;
}

export function isAutoResumeEnabled(): boolean {
  return getDownloadSettings().autoResume;
}

export function areDownloadNotificationsEnabled(): boolean {
  return getDownloadSettings().notificationsEnabled;
}

export function getMaxConcurrentDownloads(): number {
  return getDownloadSettings().maxConcurrentDownloads;
}

/**
 * Single source of truth for Day 2 scheduler consumption.
 * Falls back to DEFAULT (2) when anything is invalid.
 */
export function getEffectiveMaxConcurrentDownloads(): number {
  return normalizeMaxConcurrentDownloads(getMaxConcurrentDownloads());
}

export function getDefaultDownloadSettings(): DownloadSettings {
  return { ...DEFAULT_DOWNLOAD_SETTINGS };
}
