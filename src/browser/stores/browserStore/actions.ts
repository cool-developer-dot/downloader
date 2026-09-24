import type { StoreApi } from 'zustand';

import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { resolveEffectiveDesktopMode } from '@/browser/session/desktop-mode.service';
import {
  closeTabOperation,
  createTabOperation,
  persistTabEngineState,
  reconcileMountPool,
  switchTabOperation,
  updateTabOperation,
  type BrowserTab,
} from '@/browser/tabs';
import { MAX_MOUNTED_WEBVIEWS } from '@/browser/tabs/constants';
import { scrollPositionService } from '@/browser/scroll';
import { getSecurityLevel, isBrowserHomeUrl, isSecureUrl } from '@/browser/utils';
import { normalizeLoadProgress } from '@/browser/utils/progress';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { clearIntentLoopGuardForTab } from '@/browser/navigation/intent-loop-guard';
import { socialPageContextStore } from '@/media-detection/social';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import { clearSocialSourceRefreshAttempts } from '@/media-detection/social-source/social-source-provider';
import { mediaDetectionEngine } from '@/media-detection/engine';
import { clearVerificationForTab } from '@/media-detection/social-source/verification-session';

import { initialBrowserState } from './state';
import type { BrowserActions, BrowserStore } from './types';

type SecurityFields = {
  isSecure: boolean;
  securityLevel: ReturnType<typeof getSecurityLevel>;
};

/**
 * Security fields are two `new URL()` parses, and chromeFromTab recomputed them
 * on every progress tick (~20/s while a page loads). The active tab's URL is
 * constant across all of those ticks, so memoize per URL. Bounded well above
 * MAX_OPEN_TABS — this only ever holds tab URLs.
 */
const SECURITY_FIELDS_CACHE_MAX = 16;
const securityFieldsCache = new Map<string, SecurityFields>();

function securityFields(url: string): SecurityFields {
  const cached = securityFieldsCache.get(url);
  if (cached) {
    return cached;
  }
  const fields: SecurityFields = {
    isSecure: isSecureUrl(url),
    securityLevel: getSecurityLevel(url),
  };
  if (securityFieldsCache.size >= SECURITY_FIELDS_CACHE_MAX) {
    const oldest = securityFieldsCache.keys().next().value;
    if (oldest !== undefined) {
      securityFieldsCache.delete(oldest);
    }
  }
  securityFieldsCache.set(url, fields);
  return fields;
}

function activeTab(state: BrowserStore): BrowserTab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

function persistTabs(state: Pick<BrowserStore, 'tabs' | 'activeTabId'>): void {
  persistTabEngineState({ tabs: state.tabs, activeTabId: state.activeTabId });
}

function chromeFromTab(tab: BrowserTab) {
  return {
    currentUrl: tab.url,
    pageTitle: tab.title,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isLoading: tab.loading,
    progress: tab.progress,
    error: tab.error,
    desktopMode: tab.desktopMode,
    desktopModeUserExplicit: tab.desktopModeSource === 'user',
    ...securityFields(tab.url),
  };
}

function patchActiveTab(
  set: StoreApi<BrowserStore>['setState'],
  get: StoreApi<BrowserStore>['getState'],
  patch: Partial<BrowserTab>,
  options?: { persist?: boolean },
): void {
  patchTab(set, get, get().activeTabId, patch, options);
}

/**
 * Update a specific tab. Mirrors chrome fields ONLY when that tab is still active
 * at apply time — never writes another tab's WebView events into active chrome.
 */
function patchTab(
  set: StoreApi<BrowserStore>['setState'],
  get: StoreApi<BrowserStore>['getState'],
  tabId: string,
  patch: Partial<BrowserTab>,
  options?: { persist?: boolean },
): void {
  const state = get();
  const next = updateTabOperation(
    {
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      mountedTabIds: state.mountedTabIds,
    },
    tabId,
    patch,
  );
  const tab = next.tabs.find((t) => t.id === tabId);
  const mirrorChrome = tabId === get().activeTabId;
  set({
    tabs: next.tabs,
    ...(mirrorChrome && tab ? chromeFromTab(tab) : null),
  });
  if (options?.persist !== false && (patch.url != null || patch.title != null || patch.desktopMode != null)) {
    persistTabs(get());
  }
}

/**
 * A tab whose WebView is being unmounted (mount-pool eviction / blur budget).
 * The tab itself survives, so page context is kept — only work that would
 * outlive the WebView is cancelled: in-flight media verification and the
 * pending scroll-restore inject for a view that is about to disappear.
 */
function suspendUnmountedTabs(tabIds: readonly string[]): void {
  for (const tabId of tabIds) {
    try {
      browserMediaActionService.suspendTab(tabId);
    } catch {
      // CTA seam may not be ready in early boot
    }
    try {
      scrollPositionService.cancelRestore(tabId);
    } catch {
      // Scroll seam optional during early boot
    }
  }
}

/**
 * One state object that updates the active tab and its chrome mirror together.
 * Used by the high-frequency loading/progress writers so a single `set()` does
 * the work that two nested writes used to do.
 */
function mergeActiveTabPatch(
  state: BrowserStore,
  patch: Partial<BrowserTab>,
): Partial<BrowserStore> {
  const tabId = state.activeTabId;
  const next = updateTabOperation(
    {
      tabs: state.tabs,
      activeTabId: tabId,
      mountedTabIds: state.mountedTabIds,
    },
    tabId,
    patch,
  );
  const tab = next.tabs.find((t) => t.id === tabId);
  return {
    tabs: next.tabs,
    ...(tab ? chromeFromTab(tab) : null),
  };
}

function cleanupClosedTab(tabId: string): void {
  try {
    browserMediaActionService.clearTab(tabId);
  } catch {
    // CTA seam may not be ready in early boot
  }
  try {
    clearIntentLoopGuardForTab(tabId);
  } catch {
    // Intent seam optional during early boot
  }
  try {
    // Phase 4A — drop ephemeral social correlation state for closed tab.
    socialPageContextStore.clearTab(tabId);
  } catch {
    // Social correlation optional during early boot
  }
  try {
    // Phase 5A — drop ephemeral general media ownership state for closed tab.
    generalPageMediaContextStore.clearTab(tabId);
  } catch {
    // General media optional during early boot
  }
  try {
    mediaDetectionEngine.clearTab(tabId);
  } catch {
    // Detection engine optional during early boot
  }
  try {
    // Phase 4B — drop verification cache / refresh budget for closed tab.
    clearVerificationForTab(tabId);
    clearSocialSourceRefreshAttempts(tabId);
  } catch {
    // Social source optional during early boot
  }
}

export function createBrowserActions(
  set: StoreApi<BrowserStore>['setState'],
  get: StoreApi<BrowserStore>['getState'],
): BrowserActions {
  return {
    applyNavigationState: (snapshot) => {
      const state = get();
      if (isBrowserHomeUrl(state.currentUrl) && snapshot.url === 'about:blank') {
        return;
      }

      const url = isBrowserHomeUrl(snapshot.url) ? state.currentUrl : snapshot.url;
      const existingError = state.error;
      const tabPatch: Partial<BrowserTab> = {
        url,
        title: snapshot.title || state.pageTitle,
        canGoBack: snapshot.canGoBack,
        canGoForward: snapshot.canGoForward,
        loading: snapshot.loading,
      };

      // Keep branded failure visible while Chromium's error document navigates.
      // Intentional chrome navigations call clearError() before applyNavigationState.
      patchActiveTab(set, get, tabPatch, { persist: true });
      set({
        currentUrl: url,
        pageTitle: snapshot.title || get().pageTitle,
        canGoBack: snapshot.canGoBack,
        canGoForward: snapshot.canGoForward,
        isLoading: snapshot.loading,
        ...securityFields(url),
        error: existingError,
      });
    },

    /**
     * Loading and progress are the two highest-frequency writes in the browser.
     * They used to `set()` twice per event — once for chrome, once through
     * patchActiveTab — so every progress tick notified every store subscriber
     * twice. One set() per event, mirroring chrome from the same patch.
     */
    setLoading: (isLoading) => {
      const state = get();
      const progress = isLoading
        ? normalizeLoadProgress(state.progress, true, state.progress)
        : state.progress;
      set(
        mergeActiveTabPatch(state, {
          loading: isLoading,
          progress,
        }),
      );
    },

    setProgress: (progress) => {
      const state = get();
      const next = normalizeLoadProgress(progress, state.isLoading, state.progress);
      if (next === state.progress) {
        const activeUnchanged = activeTab(state)?.progress === next;
        if (activeUnchanged) {
          return;
        }
      }
      set(mergeActiveTabPatch(state, { progress: next }));
    },

    setPageTitle: (title) => {
      set({ pageTitle: title });
      patchActiveTab(set, get, { title }, { persist: true });
    },

    setCurrentUrl: (url) => {
      set({
        currentUrl: url,
        ...securityFields(url),
      });
      patchActiveTab(set, get, { url }, { persist: true });
    },

    goHome: () => {
      const homeFields = {
        currentUrl: BROWSER_HOMEPAGE,
        pageTitle: 'Home',
        isLoading: false,
        progress: 0,
        canGoBack: false,
        canGoForward: false,
        error: null,
        ...securityFields(BROWSER_HOMEPAGE),
      };
      set(homeFields);
      patchActiveTab(
        set,
        get,
        {
          url: BROWSER_HOMEPAGE,
          title: 'Home',
          loading: false,
          progress: 0,
          canGoBack: false,
          canGoForward: false,
          error: null,
        },
        { persist: true },
      );
    },

    setError: (error) => {
      set({
        error,
        isLoading: false,
        progress: 0,
      });
      patchActiveTab(
        set,
        get,
        { error, loading: false, progress: 0 },
        { persist: false },
      );
    },

    clearError: () => {
      set({ error: null });
      patchActiveTab(set, get, { error: null }, { persist: false });
    },

    markVisited: (timestamp = Date.now()) => {
      set({ lastVisited: timestamp });
    },

    resetSession: () => {
      const {
        tabs,
        activeTabId,
        mountedTabIds,
        downloads,
        history,
        bookmarks,
        readerMode,
        incognito,
        desktopMode,
        desktopModeUserExplicit,
      } = get();
      set({
        ...initialBrowserState,
        tabs,
        activeTabId,
        mountedTabIds,
        downloads,
        history,
        bookmarks,
        readerMode,
        incognito,
        desktopMode,
        desktopModeUserExplicit,
      });
    },

    reset: () => {
      set(initialBrowserState);
    },

    setDesktopMode: (enabled, options) => {
      const source = options?.source ?? 'user';
      const state = get();
      const targetTabId = options?.tabId ?? state.activeTabId;
      const tab = state.tabs.find((t) => t.id === targetTabId);
      if (!tab) {
        return;
      }

      if (source === 'user') {
        // Per-tab only — do NOT mutate global MMKV default (Phase 3A/3B freeze).
        // Capture targetTabId at call time so async/switch races cannot retarget B.
        patchTab(
          set,
          get,
          targetTabId,
          {
            desktopMode: enabled,
            desktopModeSource: 'user',
          },
          { persist: true },
        );
        return;
      }

      // Platform recommendation — only if this tab is not user-explicit
      if (tab.desktopModeSource === 'user') {
        return;
      }

      const resolved = resolveEffectiveDesktopMode({
        userPreference: tab.desktopMode,
        userPreferenceExplicit: false,
        platformPrefersDesktop: enabled,
      });

      if (resolved.desktopMode === tab.desktopMode) {
        return;
      }

      patchTab(
        set,
        get,
        targetTabId,
        {
          desktopMode: resolved.desktopMode,
          desktopModeSource: 'platform',
        },
        { persist: true },
      );
    },

    createTab: (options) => {
      const state = get();
      const { result, next } = createTabOperation(
        {
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          mountedTabIds: state.mountedTabIds,
        },
        options,
      );
      if (result.status !== 'CREATED') {
        return result;
      }

      // Creating a tab can evict a mounted one — cancel its work like a switch does.
      suspendUnmountedTabs(result.evictedTabIds);

      const tab = next.tabs.find((t) => t.id === next.activeTabId)!;
      set({
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        mountedTabIds: next.mountedTabIds,
        ...chromeFromTab(tab),
      });
      persistTabs(get());
      browserMediaActionService.setActiveTab(next.activeTabId);
      return result;
    },

    closeTab: (tabId) => {
      const state = get();
      const { result, next } = closeTabOperation(
        {
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          mountedTabIds: state.mountedTabIds,
        },
        tabId,
      );

      if (result.status === 'NOT_FOUND' || result.status === 'FAILED') {
        return result;
      }

      cleanupClosedTab(tabId);
      suspendUnmountedTabs(result.evictedTabIds);

      const tab = next.tabs.find((t) => t.id === next.activeTabId)!;
      set({
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        mountedTabIds: next.mountedTabIds,
        ...chromeFromTab(tab),
      });
      persistTabs(get());
      browserMediaActionService.setActiveTab(next.activeTabId);
      return result;
    },

    switchTab: (tabId) => {
      const state = get();
      const { result, next } = switchTabOperation(
        {
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          mountedTabIds: state.mountedTabIds,
        },
        tabId,
      );

      if (result.status === 'NOT_FOUND' || result.status === 'FAILED') {
        return result;
      }

      if (result.status === 'NOOP') {
        return result;
      }

      if (result.status === 'SWITCHED') {
        suspendUnmountedTabs(result.evictedTabIds);
      }

      const tab = next.tabs.find((t) => t.id === next.activeTabId)!;
      set({
        tabs: next.tabs,
        activeTabId: next.activeTabId,
        mountedTabIds: next.mountedTabIds,
        ...chromeFromTab(tab),
      });
      persistTabs(get());
      browserMediaActionService.setActiveTab(next.activeTabId);
      return result;
    },

    updateTab: (tabId, patch) => {
      const state = get();
      const next = updateTabOperation(
        {
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          mountedTabIds: state.mountedTabIds,
        },
        tabId,
        patch,
      );
      const shouldPersist =
        patch.url != null ||
        patch.title != null ||
        patch.desktopMode != null ||
        patch.desktopModeSource != null;

      if (tabId === state.activeTabId) {
        const tab = next.tabs.find((t) => t.id === tabId);
        set({
          tabs: next.tabs,
          ...(tab ? chromeFromTab(tab) : null),
        });
      } else {
        set({ tabs: next.tabs });
      }

      if (shouldPersist) {
        persistTabs(get());
      }
    },

    setMountBudget: (maxMounted) => {
      const state = get();
      const budget = Math.max(1, Math.min(maxMounted, MAX_MOUNTED_WEBVIEWS));
      if (state.mountedTabIds.length <= budget) {
        return;
      }

      const reconciled = reconcileMountPool({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        mountedTabIds: state.mountedTabIds,
        maxMounted: budget,
      });

      if (reconciled.evictedTabIds.length === 0) {
        return;
      }

      suspendUnmountedTabs(reconciled.evictedTabIds);
      set({
        tabs: reconciled.tabs,
        mountedTabIds: reconciled.mountedTabIds,
      });
    },

    syncChromeFromActiveTab: () => {
      const tab = activeTab(get());
      if (!tab) {
        return;
      }
      set(chromeFromTab(tab));
    },
  };
}
