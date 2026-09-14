import type { StoreApi } from 'zustand';

import { BROWSER_HOMEPAGE } from '@/browser/constants';
import { resolveEffectiveDesktopMode } from '@/browser/session/desktop-mode.service';
import {
  closeTabOperation,
  createTabOperation,
  persistTabEngineState,
  switchTabOperation,
  updateTabOperation,
  type BrowserTab,
} from '@/browser/tabs';
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

function securityFields(url: string) {
  return {
    isSecure: isSecureUrl(url),
    securityLevel: getSecurityLevel(url),
  };
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

    setLoading: (isLoading) => {
      set((state) => ({
        isLoading,
        progress: isLoading
          ? normalizeLoadProgress(state.progress, true, state.progress)
          : state.progress,
        // Preserve BrowserFailure — cleared only by clearError / loadUrl / reload / goHome.
        error: state.error,
      }));
      patchActiveTab(
        set,
        get,
        {
          loading: isLoading,
          progress: get().progress,
        },
        { persist: false },
      );
    },

    setProgress: (progress) => {
      set((state) => ({
        progress: normalizeLoadProgress(progress, state.isLoading, state.progress),
      }));
      patchActiveTab(set, get, { progress: get().progress }, { persist: false });
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

      if (result.status === 'SWITCHED' && result.evictedTabId) {
        try {
          browserMediaActionService.suspendTab(result.evictedTabId);
        } catch {
          // ignore
        }
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

    syncChromeFromActiveTab: () => {
      const tab = activeTab(get());
      if (!tab) {
        return;
      }
      set(chromeFromTab(tab));
    },
  };
}
