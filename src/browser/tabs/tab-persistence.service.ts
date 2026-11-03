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
import { profileScopedKey, subscribeActiveProfile } from '@/storage/profile/active-profile';

import {
  BROWSER_TABS_SCHEMA_VERSION,
  MAX_OPEN_TABS,
  TAB_PERSIST_DEBOUNCE_MS,
} from './constants';
import { envelopeTabsForWrite, parseTabsEnvelope } from './tab-envelope';
import {
  createHomeTab,
  createTabFromPersisted,
  readNewTabDesktopDefault,
  toPersistedTabMetadata,
} from './tab-factory';
import { normalizePinnedOrder } from './tab-list-ops';
import type { BrowserTab, PersistedBrowserTabsEnvelope } from './types';
import { coldStartMountPool } from './mount-pool';
import { shouldPersistForTab } from './tab-privacy';

function sanitizeEnvelope(raw: unknown): PersistedBrowserTabsEnvelope | null {
  const parsed = parseTabsEnvelope(raw, {
    homeUrl: BROWSER_HOMEPAGE,
    isHomeUrl: isBrowserHomeUrl,
    sanitizeUrl: stripSensitiveAuthQueryParams,
    maxTabs: MAX_OPEN_TABS,
    now: Date.now(),
  });
  if (!parsed) {
    return null;
  }
  return {
    schemaVersion: BROWSER_TABS_SCHEMA_VERSION,
    activeTabId: parsed.activeTabId,
    tabs: envelopeTabsForWrite(parsed.tabs),
    updatedAt: parsed.updatedAt,
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

/** B20: each browser profile has its own open tabs. */
function tabsKey(): string {
  return profileScopedKey(mmkvKeys.browserTabs);
}

function scheduleWrite(envelope: PersistedBrowserTabsEnvelope): void {
  memoryCache = envelope;
  pendingWrite = envelope;
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  // The profile these tabs belong to, even if the write lands after a profile switch.
  const key = tabsKey();
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const next = pendingWrite;
    pendingWrite = null;
    if (!next) {
      return;
    }
    mmkvSetObject(key, next);
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
    const raw = memoryCache ?? mmkvGetObject<PersistedBrowserTabsEnvelope>(tabsKey());
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
    tabs: envelopeTabsForWrite(
      normalizePinnedOrder(input.tabs.filter(shouldPersistForTab)).map(toPersistedTabMetadata),
    ),
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
    mmkvSetObject(tabsKey(), pendingWrite);
    pendingWrite = null;
  } else if (memoryCache) {
    mmkvSetObject(tabsKey(), memoryCache);
  }
}

export function clearPersistedTabEngine(): void {
  memoryCache = null;
  pendingWrite = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  mmkvRemove(tabsKey());
}

/** Test helper — inject envelope without debounce. */
export function __dangerouslyWriteTabEnvelopeForTests(
  envelope: PersistedBrowserTabsEnvelope,
): void {
  memoryCache = envelope;
  mmkvSetObject(tabsKey(), envelope);
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

// B20: another profile's tabs are read fresh (the profile switch flushes these first).
subscribeActiveProfile(() => {
  memoryCache = null;
  pendingWrite = null;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
});
