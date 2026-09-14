import { BROWSER_HOMEPAGE } from '@/browser/constants';
import {
  isRestorableBrowserUrl,
  readBrowserSessionSync,
  resolveRestorableSessionUrl,
  stripSensitiveAuthQueryParams,
} from '@/browser/session';
import { isBrowserHomeUrl, isSecureUrl } from '@/browser/utils';
import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvRemove, mmkvSetObject } from '@/storage/mmkv';

import {
  BROWSER_TABS_SCHEMA_VERSION,
  MAX_OPEN_TABS,
  TAB_PERSIST_DEBOUNCE_MS,
} from './constants';
import { createHomeTab, createTabFromPersisted, toPersistedTabMetadata } from './tab-factory';
import type {
  BrowserTab,
  DesktopModeSource,
  PersistedBrowserTabsEnvelope,
  PersistedTabMetadata,
} from './types';
import { coldStartMountPool } from './mount-pool';
import { readNewTabDesktopDefault } from './tab-factory';

function isHttpUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidPersistedUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) {
    return false;
  }
  if (isBrowserHomeUrl(trimmed)) {
    return true;
  }
  return isHttpUrl(trimmed);
}

function sanitizeDesktopSource(raw: unknown): DesktopModeSource {
  if (raw === 'user' || raw === 'platform' || raw === 'default') {
    return raw;
  }
  return 'default';
}

function sanitizePersistedTab(raw: unknown): PersistedTabMetadata | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Partial<PersistedTabMetadata>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const url = typeof obj.url === 'string' ? obj.url.trim() : '';
  if (!id || !isValidPersistedUrl(url)) {
    return null;
  }
  const createdAt =
    typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt)
      ? obj.createdAt
      : Date.now();
  const lastActiveAt =
    typeof obj.lastActiveAt === 'number' && Number.isFinite(obj.lastActiveAt)
      ? obj.lastActiveAt
      : createdAt;
  const safeUrl = isBrowserHomeUrl(url)
    ? BROWSER_HOMEPAGE
    : stripSensitiveAuthQueryParams(url);
  return {
    id,
    url: safeUrl,
    title: typeof obj.title === 'string' ? obj.title.slice(0, 255) : '',
    createdAt,
    lastActiveAt,
    desktopMode: Boolean(obj.desktopMode),
    desktopModeSource: sanitizeDesktopSource(obj.desktopModeSource),
  };
}

function sanitizeEnvelope(raw: unknown): PersistedBrowserTabsEnvelope | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Partial<PersistedBrowserTabsEnvelope>;
  const schemaVersion =
    typeof obj.schemaVersion === 'number' && Number.isFinite(obj.schemaVersion)
      ? obj.schemaVersion
      : 0;
  if (schemaVersion > BROWSER_TABS_SCHEMA_VERSION) {
    // Future schema — refuse rather than corrupt.
    return null;
  }

  const list = Array.isArray(obj.tabs) ? obj.tabs : [];
  const seen = new Set<string>();
  const tabs: PersistedTabMetadata[] = [];
  for (const entry of list) {
    const tab = sanitizePersistedTab(entry);
    if (!tab || seen.has(tab.id)) {
      continue;
    }
    seen.add(tab.id);
    tabs.push(tab);
  }

  if (tabs.length === 0) {
    return null;
  }

  // Prefer active + most recent when trimming > max
  tabs.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  let activeTabId =
    typeof obj.activeTabId === 'string' && obj.activeTabId.trim()
      ? obj.activeTabId.trim()
      : tabs[0]!.id;

  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0]!.id;
  }

  const active = tabs.find((t) => t.id === activeTabId)!;
  const others = tabs.filter((t) => t.id !== activeTabId);
  const trimmed = [active, ...others].slice(0, MAX_OPEN_TABS);

  // Restore original relative order by lastActiveAt desc for UI (active first among equals ok)
  const orderIds = new Set(trimmed.map((t) => t.id));
  const ordered = tabs.filter((t) => orderIds.has(t.id)).slice(0, MAX_OPEN_TABS);

  return {
    schemaVersion: BROWSER_TABS_SCHEMA_VERSION,
    activeTabId,
    tabs: ordered.length ? ordered : trimmed,
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt)
        ? obj.updatedAt
        : Date.now(),
  };
}

export type HydratedTabEngineState = {
  tabs: BrowserTab[];
  activeTabId: string;
  mountedTabIds: string[];
};

let memoryCache: PersistedBrowserTabsEnvelope | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: PersistedBrowserTabsEnvelope | null = null;

function scheduleWrite(envelope: PersistedBrowserTabsEnvelope): void {
  memoryCache = envelope;
  pendingWrite = envelope;
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const next = pendingWrite;
    pendingWrite = null;
    if (!next) {
      return;
    }
    mmkvSetObject(mmkvKeys.browserTabs, next);
  }, TAB_PERSIST_DEBOUNCE_MS);
}

export function buildFreshTabEngineState(): HydratedTabEngineState {
  // Migrate legacy single-URL session into one tab when present.
  try {
    const session = readBrowserSessionSync();
    const restorable = resolveRestorableSessionUrl(session);
    if (restorable && isRestorableBrowserUrl(restorable.url)) {
      const desktop = readNewTabDesktopDefault();
      const now = Date.now();
      const tab = createHomeTab({
        url: restorable.url,
        title: restorable.title || '',
        desktopMode: desktop.desktopMode,
        desktopModeSource: desktop.desktopModeSource,
        mountState: 'MOUNTED_ACTIVE',
        lastMountedAt: now,
        createdAt: now,
        lastActiveAt: now,
      });
      return {
        tabs: [tab],
        activeTabId: tab.id,
        mountedTabIds: coldStartMountPool(tab.id),
      };
    }
  } catch {
    // fall through to home
  }

  const home = createHomeTab({
    mountState: 'MOUNTED_ACTIVE',
    lastMountedAt: Date.now(),
  });
  return {
    tabs: [home],
    activeTabId: home.id,
    mountedTabIds: coldStartMountPool(home.id),
  };
}

/**
 * Hydrate tab engine from MMKV. Never throws — recovers to one Home tab.
 */
export function hydrateTabEngineState(): HydratedTabEngineState {
  try {
    const raw = memoryCache ?? mmkvGetObject<PersistedBrowserTabsEnvelope>(mmkvKeys.browserTabs);
    const envelope = sanitizeEnvelope(raw);
    if (!envelope) {
      return buildFreshTabEngineState();
    }
    memoryCache = envelope;
    const tabs = envelope.tabs.map(createTabFromPersisted);
    const activeTabId = envelope.activeTabId;
    const mountedTabIds = coldStartMountPool(activeTabId);
    const withMount = tabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            mountState: 'MOUNTED_ACTIVE' as const,
            lastMountedAt: Date.now(),
            // Evicted restore policy: never fake native history
            canGoBack: false,
            canGoForward: false,
          }
        : {
            ...tab,
            mountState: 'EVICTED' as const,
            canGoBack: false,
            canGoForward: false,
            lastMountedAt: null,
          },
    );
    return { tabs: withMount, activeTabId, mountedTabIds };
  } catch {
    return buildFreshTabEngineState();
  }
}

export function persistTabEngineState(input: {
  tabs: BrowserTab[];
  activeTabId: string;
}): void {
  const envelope: PersistedBrowserTabsEnvelope = {
    schemaVersion: BROWSER_TABS_SCHEMA_VERSION,
    activeTabId: input.activeTabId,
    tabs: input.tabs.map(toPersistedTabMetadata),
    updatedAt: Date.now(),
  };
  scheduleWrite(envelope);
}

export function flushTabEnginePersistence(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrite) {
    mmkvSetObject(mmkvKeys.browserTabs, pendingWrite);
    pendingWrite = null;
  } else if (memoryCache) {
    mmkvSetObject(mmkvKeys.browserTabs, memoryCache);
  }
}

export function clearPersistedTabEngine(): void {
  memoryCache = null;
  pendingWrite = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  mmkvRemove(mmkvKeys.browserTabs);
}

/** Test helper — inject envelope without debounce. */
export function __dangerouslyWriteTabEnvelopeForTests(
  envelope: PersistedBrowserTabsEnvelope,
): void {
  memoryCache = envelope;
  mmkvSetObject(mmkvKeys.browserTabs, envelope);
}

export function __resetTabPersistenceForTests(): void {
  clearPersistedTabEngine();
}

/** Active-tab chrome seed from hydrated tabs (security fields applied by caller). */
export function resolveActiveChromeSeed(state: HydratedTabEngineState): {
  currentUrl: string;
  pageTitle: string;
  desktopMode: boolean;
  desktopModeUserExplicit: boolean;
  isSecure: boolean;
} {
  const active = state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]!;
  return {
    currentUrl: active.url,
    pageTitle: active.title,
    desktopMode: active.desktopMode,
    desktopModeUserExplicit: active.desktopModeSource === 'user',
    isSecure: isSecureUrl(active.url),
  };
}
