import type { StoreApi } from 'zustand';

import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { resolveEffectiveDesktopMode } from '@/browser/session/desktop-mode.service';
import {
  closeTabOperation,
  createTabOperation,
  reconcileMountPool,
  switchTabOperation,
  updateTabOperation,
  type BrowserTab,
} from '@/browser/tabs';
import { MAX_MOUNTED_WEBVIEWS } from '@/browser/tabs/constants';
import { tabSnapshots } from '@/browser/tabs/tab-snapshots';
import { isBrowserHomeUrl } from '@/browser/utils';
import { normalizeLoadProgress } from '@/browser/utils/progress';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';

import { initialBrowserState } from './state';
import {
  chromeFromTab,
  cleanupClosedTab,
  persistTabs,
  securityFields,
  suspendUnmountedTabs,
} from './store-helpers';
import { recordClosedTabs } from './tab-management-actions';
import type { BrowserActions, BrowserStore } from './types';

function activeTab(state: BrowserStore): BrowserTab | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
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
      const leaving = state.tabs.find((t) => t.id === state.activeTabId);
      if (leaving) {
        void tabSnapshots.capture(leaving);
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

    closeTab: (tabId, options) => {
      const state = get();
      const closing = state.tabs.find((t) => t.id === tabId);
      const closingIndex = state.tabs.findIndex((t) => t.id === tabId);
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
      // B1 #3: remember it for Reopen closed tab, and offer Undo.
      if (closing && options?.record !== false) {
        recordClosedTabs([{ tab: closing, index: closingIndex }], {
          replacementHomeTabId: result.status === 'REPLACED_HOME' ? result.tab.id : null,
          activeTabId: state.activeTabId,
          openTabs: get().tabs,
        });
      }
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
      // B1 #14: the tab being left gets a fresh preview.
      const leaving = state.tabs.find((t) => t.id === state.activeTabId);
      if (leaving) {
        void tabSnapshots.capture(leaving);
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
