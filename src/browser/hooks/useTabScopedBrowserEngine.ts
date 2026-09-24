import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type WebView from 'react-native-webview';

import { BROWSER_WEBVIEW_BLANK } from '@/browser/constants';
import type { BrowserEngineContextValue, ChromeNavState } from '@/browser/engine';
import {
  blankWebView,
  browserSyncService,
  goBackWebView,
  goForwardWebView,
  navigationService,
  reloadWebView,
  stopWebViewLoading,
} from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { isBlockedScheme, isBrowserHomeUrl, isExternalScheme } from '@/browser/utils';
import {
  logBrowserNav,
  logBrowserWebView,
  safeBrowserHost,
  sanitizeBrowserUrl,
} from '@/browser/diagnostics';
import { describePlatformPage } from '@/media-detection/platform';
import { isSameDocumentUrl } from '@/media-detection/utils';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';

type WebViewWithHistory = WebView & {
  clearHistory?: () => void;
};

/**
 * Per-mounted-tab WebView controller.
 * Registers with tabControllerRegistry for the chrome facade.
 */
export function useTabScopedBrowserEngine(tabId: string): BrowserEngineContextValue {
  const webViewRef = useRef<WebView | null>(null);
  const navigationEpochRef = useRef(0);
  const loadStartEpochRef = useRef(0);
  const loadStartUrlRef = useRef<string | null>(null);
  const chromeNavRef = useRef<ChromeNavState>({ stack: [], index: -1 });
  const nativeCanGoBackRef = useRef(false);
  const nativeCanGoForwardRef = useRef(false);
  const suppressNextAbortErrorRef = useRef(false);
  /** Armed only while a user Back is walking native history — see the context type. */
  const pendingNativeBackRef = useRef(false);
  const webViewInstanceGenerationRef = useRef(1);

  const [sourceUri, setSourceUri] = useState(() => {
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
    const url = tab?.url ?? useBrowserStore.getState().currentUrl;
    return isBrowserHomeUrl(url) ? BROWSER_WEBVIEW_BLANK : url || BROWSER_WEBVIEW_BLANK;
  });

  const updateTab = useBrowserStore((state) => state.updateTab);
  const isActiveTab = useBrowserStore((state) => state.activeTabId === tabId);

  const bumpNavigationEpoch = useCallback(() => {
    navigationEpochRef.current += 1;
    updateTab(tabId, { navigationEpoch: navigationEpochRef.current });
    return navigationEpochRef.current;
  }, [tabId, updateTab]);

  const seedActiveDocumentLoad = useCallback((epoch: number, url: string | null) => {
    loadStartEpochRef.current = epoch;
    loadStartUrlRef.current = url;
  }, []);

  const publishChromeHistoryFlags = useCallback(() => {
    // Native WebView history only — never OR chrome-stack into Forward/Back flags.
    // Evicted tabs reset these in the mount pool; mounted tabs report native state.
    const canGoBack = nativeCanGoBackRef.current;
    const canGoForward = nativeCanGoForwardRef.current;
    updateTab(tabId, { canGoBack, canGoForward });
  }, [tabId, updateTab]);

  const goHome = useCallback(() => {
    pendingNativeBackRef.current = false;
    const navId = bumpNavigationEpoch();
    seedActiveDocumentLoad(navId, null);
    logBrowserNav(navId, 'home', { decisionReason: 'chrome_go_home', tabId });
    chromeNavRef.current = { stack: [], index: -1 };
    nativeCanGoBackRef.current = false;
    nativeCanGoForwardRef.current = false;
    setSourceUri(BROWSER_WEBVIEW_BLANK);
    blankWebView(webViewRef.current);
    const webView = webViewRef.current as WebViewWithHistory | null;
    webView?.clearHistory?.();
    // Preserve desktopMode / desktopModeSource — Home is chrome, not a Desktop reset.
    updateTab(tabId, {
      url: 'vidorax://home',
      title: 'Home',
      loading: false,
      progress: 0,
      canGoBack: false,
      canGoForward: false,
      error: null,
    });
    if (useBrowserStore.getState().activeTabId === tabId) {
      useBrowserStore.getState().goHome();
    }
    browserSyncService.onGoHome();
  }, [bumpNavigationEpoch, seedActiveDocumentLoad, tabId, updateTab]);

  const goBack = useCallback(() => {
    if (nativeCanGoBackRef.current) {
      logBrowserNav(navigationEpochRef.current, 'back', {
        strategy: 'native_webview',
        canGoBack: true,
        tabId,
      });
      // Landing on the seeded about:blank means there is no page behind this
      // one — the event handler turns that into Home instead of a blank tab.
      pendingNativeBackRef.current = true;
      goBackWebView(webViewRef.current);
      return;
    }

    // No native history → Browser Home (deterministic; no chrome-stack sourceUri remount).
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
    if (tab && !isBrowserHomeUrl(tab.url)) {
      logBrowserNav(navigationEpochRef.current, 'back', {
        strategy: 'home_fallback',
        canGoBack: false,
        tabId,
      });
      goHome();
    }
  }, [goHome, tabId]);

  const goForward = useCallback(() => {
    if (!nativeCanGoForwardRef.current) {
      return;
    }
    logBrowserNav(navigationEpochRef.current, 'forward', {
      strategy: 'native_webview',
      canGoForward: true,
      tabId,
    });
    goForwardWebView(webViewRef.current);
  }, [tabId]);

  const reload = useCallback(() => {
    const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
    if (!tab || isBrowserHomeUrl(tab.url)) {
      return;
    }
    if (tab.loading) {
      return;
    }
    const current = tab.url;
    pendingNativeBackRef.current = false;
    const navId = bumpNavigationEpoch();
    seedActiveDocumentLoad(navId, current);
    logBrowserNav(navId, 'reload', {
      safeHost: safeBrowserHost(current),
      tabId,
    });
    updateTab(tabId, { error: null, loading: true });
    if (useBrowserStore.getState().activeTabId === tabId) {
      useBrowserStore.getState().clearError();
      useBrowserStore.getState().setLoading(true);
    }
    reloadWebView(webViewRef.current);
  }, [bumpNavigationEpoch, seedActiveDocumentLoad, tabId, updateTab]);

  const stopLoading = useCallback(() => {
    suppressNextAbortErrorRef.current = true;
    logBrowserNav(navigationEpochRef.current, 'stop', {
      safeHost: safeBrowserHost(
        useBrowserStore.getState().tabs.find((t) => t.id === tabId)?.url ?? '',
      ),
      tabId,
    });
    stopWebViewLoading(webViewRef.current);
    updateTab(tabId, { loading: false });
    if (useBrowserStore.getState().activeTabId === tabId) {
      useBrowserStore.getState().setLoading(false);
    }
  }, [tabId, updateTab]);

  const loadUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) {
        return;
      }

      pendingNativeBackRef.current = false;

      if (isBrowserHomeUrl(trimmed)) {
        goHome();
        return;
      }

      if (!navigationService.shouldHandleInBrowser(trimmed)) {
        if (isExternalScheme(trimmed) && !isBlockedScheme(trimmed)) {
          void navigationService.openExternal(trimmed);
        }
        return;
      }

      const tab = useBrowserStore.getState().tabs.find((t) => t.id === tabId);
      const previousUrl = tab?.url ?? '';
      const wasHome = isBrowserHomeUrl(previousUrl);

      if (!wasHome && isSameDocumentUrl(previousUrl, trimmed)) {
        logBrowserNav(navigationEpochRef.current, 'request', {
          skipped: true,
          decisionReason: 'same_document',
          safeHost: safeBrowserHost(trimmed),
          tabId,
        });
        return;
      }

      const platform = describePlatformPage(trimmed);
      if (tab && tab.desktopModeSource !== 'user') {
        if (platform.prefersDesktopWebView && !tab.desktopMode) {
          useBrowserStore.getState().setDesktopMode(true, {
            source: 'platform',
            tabId,
          });
        } else if (
          tab.desktopMode &&
          tab.desktopModeSource === 'platform' &&
          !platform.prefersDesktopWebView
        ) {
          useBrowserStore.getState().setDesktopMode(false, {
            source: 'platform',
            tabId,
          });
        }
      }

      const chrome = chromeNavRef.current;
      const nextStack = chrome.stack.slice(0, chrome.index + 1);
      nextStack.push(trimmed);
      chrome.stack = nextStack;
      chrome.index = nextStack.length - 1;
      nativeCanGoForwardRef.current = false;

      const navId = bumpNavigationEpoch();
      seedActiveDocumentLoad(navId, trimmed);
      const urlMeta = sanitizeBrowserUrl(trimmed);
      logBrowserNav(navId, 'chrome_load', {
        safeHost: urlMeta.safeHost,
        safePathPattern: urlMeta.safePathPattern,
        decisionReason: 'chrome_load_url',
        tabId,
      });
      updateTab(tabId, {
        url: trimmed,
        error: null,
        loading: true,
        progress: 0.02,
      });
      // updateTab mirrors chrome when this tab is active — do not call patchActiveTab Raw helpers.
      browserSyncService.onNavigate(trimmed);

      setSourceUri(trimmed);
      logBrowserWebView({
        event: 'source_changed',
        navigationId: navId,
        safeHost: urlMeta.safeHost,
        tabId,
      });
      publishChromeHistoryFlags();
    },
    [
      bumpNavigationEpoch,
      goHome,
      publishChromeHistoryFlags,
      seedActiveDocumentLoad,
      tabId,
      updateTab,
    ],
  );

  const value = useMemo(
    () => ({
      tabId,
      webViewRef,
      sourceUri,
      navigationEpochRef,
      loadStartEpochRef,
      loadStartUrlRef,
      chromeNavRef,
      nativeCanGoBackRef,
      nativeCanGoForwardRef,
      suppressNextAbortErrorRef,
      pendingNativeBackRef,
      webViewInstanceGenerationRef,
      publishChromeHistoryFlags,
      goBack,
      goForward,
      reload,
      stopLoading,
      loadUrl,
      goHome,
    }),
    [
      tabId,
      sourceUri,
      publishChromeHistoryFlags,
      goBack,
      goForward,
      reload,
      stopLoading,
      loadUrl,
      goHome,
    ],
  );

  useEffect(() => {
    tabControllerRegistry.register(tabId, value);
  }, [tabId, value]);

  // Zero generation ONLY on true unmount — never on sourceUri / value identity churn.
  // Re-registering on every loadUrl previously zeroed the live gate and permanently
  // broke Back/Forward/Home + loading clears (withOwningTabGuard / resolveLiveController).
  useEffect(() => {
    if (webViewInstanceGenerationRef.current <= 0) {
      webViewInstanceGenerationRef.current = 1;
    }
    return () => {
      webViewInstanceGenerationRef.current = 0;
      tabControllerRegistry.unregister(tabId);
    };
  }, [tabId]);

  // When this tab becomes active after being parked, re-sync chrome mirrors.
  useEffect(() => {
    if (!isActiveTab) {
      return;
    }
    useBrowserStore.getState().syncChromeFromActiveTab();
  }, [isActiveTab]);

  return value;
}
