import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewNavigation,
  WebViewNavigationEvent,
  WebViewOpenWindowEvent,
  WebViewProgressEvent,
  WebViewRenderProcessGoneEvent,
  WebViewTerminatedEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { useTheme } from '@/hooks/use-theme';
import { useMediaDetectionBridge } from '@/media-detection';
import {
  logBrowserDesktop,
  logBrowserSession,
  logBrowserWebView,
  logBrowserWindow,
  safeBrowserHost,
} from '@/browser/diagnostics';
import { resolvePopupNavigation } from '@/browser/navigation/popup-navigation.service';
import { openIntentOrExternal } from '@/browser/navigation/external-navigation.service';
import { useTranslation } from '@/localization';

import type { BrowserChromeBridgeBindings } from '@/browser/hooks';
import { browserUserAgentMode } from '@/browser/constants';
import { resolveWebViewUserAgentForTab } from '@/browser/constants/user-agent';
import { useBrowserEngineContext } from '@/browser/engine';
import { useBrowserEngineEvents } from '@/browser/hooks';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';
import {
  BROWSER_WEBVIEW_CACHE_MODE_DEFAULT,
  BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD,
  browserWebViewConfiguration,
  resolveScalesPageToFit,
  type BrowserWebViewCacheMode,
} from '@/browser/webview/webview-configuration';

export type BrowserWebViewProps = {
  testID?: string;
  chromeBridge: BrowserChromeBridgeBindings;
  /** Phase 3B — owning tab + whether this instance drives chrome. */
  tabId?: string;
  isActive?: boolean;
};

function computePullToRefreshEnabled(state: {
  currentUrl: string;
  isLoading: boolean;
  error: unknown;
}): boolean {
  return !isBrowserHomeUrl(state.currentUrl) && !state.isLoading && state.error == null;
}

/**
 * Thin WebView host. Renders and reports events only — no domain logic.
 * Media detection + browser chrome are passive observers (inject + onMessage).
 */
export const BrowserWebView = memo(function BrowserWebView({
  testID = 'browser-webview',
  chromeBridge,
  tabId,
  isActive = true,
}: BrowserWebViewProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    webViewRef,
    sourceUri,
    reload,
    loadUrl,
    navigationEpochRef,
    webViewInstanceGenerationRef,
  } = useBrowserEngineContext();
  const {
    onNavigationStateChange,
    onLoadStart,
    onLoadEnd,
    onLoadProgress,
    onError,
    onHttpError,
    onContentProcessDidTerminate,
    onRenderProcessGone,
    onShouldStartLoadWithRequest,
  } = useBrowserEngineEvents();
  const {
    injectedJavaScript: mediaInjected,
    injectedJavaScriptBeforeContentLoaded: mediaBeforeContent,
    onMessage: onMediaDetectionMessage,
  } = useMediaDetectionBridge();

  const [pullToRefreshEnabled, setPullToRefreshEnabled] = useState(() =>
    computePullToRefreshEnabled(useBrowserStore.getState()),
  );

  const [cacheMode, setCacheMode] = useState<BrowserWebViewCacheMode>(
    BROWSER_WEBVIEW_CACHE_MODE_DEFAULT,
  );

  useEffect(() => {
    return useBrowserStore.subscribe((state) => {
      const next = computePullToRefreshEnabled(state);
      setPullToRefreshEnabled((prev) => (prev === next ? prev : next));
    });
  }, []);

  const desktopMode = useBrowserStore((state) => {
    if (tabId) {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab) {
        return tab.desktopMode;
      }
    }
    return state.desktopMode;
  });
  const tabUrl = useBrowserStore((state) => {
    if (tabId) {
      return state.tabs.find((t) => t.id === tabId)?.url ?? state.currentUrl;
    }
    return state.currentUrl;
  });
  const tabLoading = useBrowserStore((state) => {
    if (tabId) {
      return state.tabs.find((t) => t.id === tabId)?.loading ?? state.isLoading;
    }
    return state.isLoading;
  });

  const mountLoggedRef = useRef(false);
  const previousSourceRef = useRef(sourceUri);
  /** Tab-scoped: one intentional UA reload at a time for THIS WebView only. */
  const desktopReloadPendingRef = useRef(false);
  /** Coalesce rapid toggles to the latest desired mode. */
  const desiredDesktopModeRef = useRef(desktopMode);
  /** When user toggles mid-load, finish current load then reload once. */
  const deferredDesktopReloadRef = useRef(false);
  /**
   * UA prop must commit before reload() — same-effect setState+reload used the OLD UA.
   * Set when appliedDesktopMode is updated; cleared when reload() fires.
   */
  const pendingUaCommitReloadRef = useRef(false);
  const reloadGenerationRef = useRef(0);
  const pendingDesktopReloadReasonRef = useRef<string>('user_or_platform_toggle');

  useEffect(() => {
    if (!mountLoggedRef.current) {
      mountLoggedRef.current = true;
      logBrowserWebView({
        event: 'mount',
        safeHost: safeBrowserHost(sourceUri),
        webViewInstanceGeneration: webViewInstanceGenerationRef.current,
      });
      logBrowserSession({
        sessionEvent: 'webview_mount',
        sessionTransitionCategory: 'webview_mount_shared_cookie_jar',
        cookiesEnabled: true,
        cookieAuthority: 'android_webview_cookie_manager',
        sharedCookiesEnabled: browserWebViewConfiguration.sharedCookiesEnabled,
        thirdPartyCookiesEnabled: browserWebViewConfiguration.thirdPartyCookiesEnabled,
        thirdPartyCookiePolicy: 'accept_for_webview',
        domStorageEnabled: browserWebViewConfiguration.domStorageEnabled,
        incognitoEnabled: browserWebViewConfiguration.incognito,
        cookieContextAvailable: true,
        webViewInstanceGeneration: webViewInstanceGenerationRef.current,
        uaMode: browserUserAgentMode(desktopMode),
      });
      logBrowserDesktop({
        event: 'mount_restore',
        tabId: tabId ?? null,
        toMode: browserUserAgentMode(desktopMode),
        mountState: isActive ? 'MOUNTED_ACTIVE' : 'MOUNTED_INACTIVE',
        isActive,
      });
    }
    return () => {
      logBrowserWebView({ event: 'unmount' });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount lifecycle only
  }, []);

  useEffect(() => {
    if (previousSourceRef.current !== sourceUri) {
      logBrowserWebView({
        event: 'source_prop',
        fromHost: safeBrowserHost(previousSourceRef.current),
        toHost: safeBrowserHost(sourceUri),
      });
      previousSourceRef.current = sourceUri;
    }
  }, [sourceUri]);

  const previousDesktopModeRef = useRef(desktopMode);
  /**
   * Freeze WebView userAgent prop while a document is loading — RN applies UA
   * immediately even when reload is deferred; mid-load mutation aborts TikTok.
   * Initialized from THIS tab's desktopMode (evicted restore applies UA before load).
   */
  const [appliedDesktopMode, setAppliedDesktopMode] = useState(desktopMode);

  // Chrome loadUrl pairs platform Desktop with sourceUri — sync THIS tab's UA only.
  // Do not depend on desktopMode here: user toggles are owned by the transition effect.
  useEffect(() => {
    const tabDesktop = tabId
      ? useBrowserStore.getState().tabs.find((t) => t.id === tabId)?.desktopMode
      : useBrowserStore.getState().desktopMode;
    const mode = tabDesktop ?? desktopMode;
    desiredDesktopModeRef.current = mode;
    setAppliedDesktopMode(mode);
    previousDesktopModeRef.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional chrome source pairing only
  }, [sourceUri]);

  const executeDesktopReload = useCallback(
    (toMode: boolean, reason: string) => {
      if (desktopReloadPendingRef.current) {
        // Coalesce: keep desired mode; finish current UA reload then settle effect may re-run.
        desiredDesktopModeRef.current = toMode;
        deferredDesktopReloadRef.current = true;
        return;
      }
      if (isBrowserHomeUrl(tabUrl)) {
        setAppliedDesktopMode(toMode);
        previousDesktopModeRef.current = toMode;
        deferredDesktopReloadRef.current = false;
        pendingUaCommitReloadRef.current = false;
        return;
      }

      // Owning-tab Desktop reload may complete while parked (switch-during-reload).
      // Never retarget another tab; only abort when this WebView is gone (unmount cleanup).

      reloadGenerationRef.current += 1;
      desktopReloadPendingRef.current = true;
      deferredDesktopReloadRef.current = false;
      desiredDesktopModeRef.current = toMode;
      previousDesktopModeRef.current = toMode;
      pendingDesktopReloadReasonRef.current = reason;
      setCacheMode(BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD);

      // Apply UA on this commit; reload() runs after appliedDesktopMode paints
      // so react-native-webview receives the new userAgent before the document reload.
      pendingUaCommitReloadRef.current = true;
      setAppliedDesktopMode(toMode);

      logBrowserDesktop({
        event: 'ua_commit_scheduled',
        tabId: tabId ?? null,
        toMode: browserUserAgentMode(toMode),
        isActive,
        reloadGeneration: reloadGenerationRef.current,
        cacheMode: BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD,
        reason,
      });
    },
    [isActive, tabId, tabUrl],
  );

  // After appliedDesktopMode commits → WebView userAgent prop updates → one reload.
  useEffect(() => {
    if (!pendingUaCommitReloadRef.current) {
      return;
    }
    if (appliedDesktopMode !== desiredDesktopModeRef.current) {
      return;
    }
    if (isBrowserHomeUrl(tabUrl)) {
      pendingUaCommitReloadRef.current = false;
      desktopReloadPendingRef.current = false;
      return;
    }

    pendingUaCommitReloadRef.current = false;
    const generation = reloadGenerationRef.current;
    logBrowserDesktop({
      event: 'reload_started',
      tabId: tabId ?? null,
      toMode: browserUserAgentMode(appliedDesktopMode),
      isActive,
      reloadGeneration: generation,
      cacheMode: BROWSER_WEBVIEW_CACHE_MODE_UA_RELOAD,
      reason: pendingDesktopReloadReasonRef.current,
    });
    reload();
  }, [appliedDesktopMode, isActive, reload, tabId, tabUrl]);

  useEffect(() => {
    desiredDesktopModeRef.current = desktopMode;

    if (previousDesktopModeRef.current === desktopMode) {
      return;
    }

    const fromMode = previousDesktopModeRef.current;

    logBrowserDesktop({
      event: 'toggle_requested',
      tabId: tabId ?? null,
      fromMode: browserUserAgentMode(fromMode),
      toMode: browserUserAgentMode(desktopMode),
      isActive,
      wasLoading: tabLoading,
    });

    // Mid-load: freeze applied UA; coalesce to final desired; reload once after settle.
    if (tabLoading) {
      previousDesktopModeRef.current = desktopMode;
      deferredDesktopReloadRef.current = true;
      logBrowserDesktop({
        event: 'reload_deferred',
        tabId: tabId ?? null,
        toMode: browserUserAgentMode(desktopMode),
        wasLoading: true,
        isActive,
      });
      logBrowserSession({
        sessionEvent: 'desktop_mode_change',
        uaMode: browserUserAgentMode(desktopMode),
        webViewRemounted: false,
        cookieContextAvailable: true,
        deferredReload: true,
        webViewInstanceGeneration: webViewInstanceGenerationRef.current,
      });
      return;
    }

    if (desktopReloadPendingRef.current) {
      previousDesktopModeRef.current = desktopMode;
      deferredDesktopReloadRef.current = true;
      logBrowserDesktop({
        event: 'reload_deferred',
        tabId: tabId ?? null,
        toMode: browserUserAgentMode(desktopMode),
        reason: 'reload_in_flight',
        isActive,
      });
      return;
    }

    logBrowserSession({
      sessionEvent: 'desktop_mode_change',
      uaMode: browserUserAgentMode(desktopMode),
      webViewRemounted: false,
      cookieContextAvailable: true,
      webViewInstanceGeneration: webViewInstanceGenerationRef.current,
    });

    executeDesktopReload(desktopMode, 'user_or_platform_toggle');
  }, [
    desktopMode,
    executeDesktopReload,
    isActive,
    tabId,
    tabLoading,
    webViewInstanceGenerationRef,
  ]);

  // After load settles: apply coalesced desired mode + at most one deferred reload.
  useEffect(() => {
    if (tabLoading) {
      return;
    }
    if (!deferredDesktopReloadRef.current) {
      return;
    }
    executeDesktopReload(desiredDesktopModeRef.current, 'deferred_after_load');
  }, [executeDesktopReload, tabLoading]);

  // Become-active reconcile: if applied UA drifted from desired while parked, one reload.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (desktopReloadPendingRef.current || tabLoading) {
      return;
    }
    if (appliedDesktopMode === desktopMode) {
      return;
    }
    desiredDesktopModeRef.current = desktopMode;
    executeDesktopReload(desktopMode, 'activate_reconcile');
  }, [appliedDesktopMode, desktopMode, executeDesktopReload, isActive, tabLoading]);

  const userAgent = useMemo(
    () => resolveWebViewUserAgentForTab({ desktopMode: appliedDesktopMode }),
    [appliedDesktopMode],
  );

  /** Per-tab viewport: Desktop → wide+overview; Mobile → no leftover desktop viewport. */
  const scalesPageToFit = useMemo(
    () => resolveScalesPageToFit(appliedDesktopMode),
    [appliedDesktopMode],
  );

  useEffect(() => {
    logBrowserDesktop({
      event: 'ua_resolved',
      tabId: tabId ?? null,
      toMode: browserUserAgentMode(appliedDesktopMode),
      isActive,
      uaOmitted: userAgent == null,
      scalesPageToFit,
    });
  }, [appliedDesktopMode, isActive, scalesPageToFit, tabId, userAgent]);

  const webViewSource = useMemo(() => ({ uri: sourceUri }), [sourceUri]);

  const injectedJavaScript = useMemo(
    () => `${chromeBridge.injectedJavaScript}\n${mediaInjected}`,
    [chromeBridge.injectedJavaScript, mediaInjected],
  );

  const injectedJavaScriptBeforeContentLoaded = useMemo(
    () =>
      `${chromeBridge.injectedJavaScriptBeforeContentLoaded}\n${mediaBeforeContent}`,
    [chromeBridge.injectedJavaScriptBeforeContentLoaded, mediaBeforeContent],
  );

  const finalizeLoadEnd = useCallback(
    (url: string) => {
      if (cacheMode !== BROWSER_WEBVIEW_CACHE_MODE_DEFAULT) {
        setCacheMode(BROWSER_WEBVIEW_CACHE_MODE_DEFAULT);
      }
      if (desktopReloadPendingRef.current) {
        desktopReloadPendingRef.current = false;
        logBrowserDesktop({
          event: 'reload_completed',
          tabId: tabId ?? null,
          toMode: browserUserAgentMode(appliedDesktopMode),
          isActive,
          reloadGeneration: reloadGenerationRef.current,
          cacheMode: BROWSER_WEBVIEW_CACHE_MODE_DEFAULT,
          safeHost: safeBrowserHost(url),
        });
      }
      onLoadEnd(url);
    },
    [appliedDesktopMode, cacheMode, isActive, onLoadEnd, tabId],
  );

  useEffect(() => {
    return () => {
      if (desktopReloadPendingRef.current || deferredDesktopReloadRef.current) {
        logBrowserDesktop({
          event: 'reload_aborted_tab_closed',
          tabId: tabId ?? null,
          reloadGeneration: reloadGenerationRef.current,
        });
      }
      desktopReloadPendingRef.current = false;
      deferredDesktopReloadRef.current = false;
      pendingUaCommitReloadRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- true unmount only (not isActive flips)
  }, []);

  const handleLoadStart = useCallback(
    (event: WebViewNavigationEvent | WebViewErrorEvent) => {
      onLoadStart(event.nativeEvent.url);
    },
    [onLoadStart],
  );

  const handleLoadEnd = useCallback(
    (event: WebViewNavigationEvent | WebViewErrorEvent) => {
      finalizeLoadEnd(event.nativeEvent.url);
    },
    [finalizeLoadEnd],
  );

  const handleProgress = useCallback(
    (event: WebViewProgressEvent) => {
      onLoadProgress(event);
    },
    [onLoadProgress],
  );

  const handleError = useCallback(
    (event: WebViewErrorEvent) => {
      if (cacheMode !== BROWSER_WEBVIEW_CACHE_MODE_DEFAULT) {
        setCacheMode(BROWSER_WEBVIEW_CACHE_MODE_DEFAULT);
      }
      desktopReloadPendingRef.current = false;
      onError(event);
    },
    [cacheMode, onError],
  );

  const handleHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => {
      onHttpError(event);
    },
    [onHttpError],
  );

  const handleNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      onNavigationStateChange(navState);
    },
    [onNavigationStateChange],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => onShouldStartLoadWithRequest(request),
    [onShouldStartLoadWithRequest],
  );

  const handleContentProcessDidTerminate = useCallback(
    (event: WebViewTerminatedEvent) => {
      onContentProcessDidTerminate(event);
    },
    [onContentProcessDidTerminate],
  );

  const handleRenderProcessGone = useCallback(
    (event: WebViewRenderProcessGoneEvent) => {
      onRenderProcessGone(event);
    },
    [onRenderProcessGone],
  );

  const handleOpenWindow = useCallback(
    (event: WebViewOpenWindowEvent) => {
      const targetUrl = event.nativeEvent.targetUrl;
      const decision = resolvePopupNavigation(targetUrl);
      const navId = navigationEpochRef.current;

      logBrowserWindow(navId, {
        event: 'popup',
        safeHost: safeBrowserHost(targetUrl),
        handled: decision.action !== 'ignore',
        strategy:
          decision.action === 'load_in_browser'
            ? 'current_webview'
            : decision.action === 'open_external'
              ? 'external'
              : 'unsupported',
        decisionReason: decision.action === 'ignore' ? decision.reason : decision.action,
      });

      if (decision.action === 'load_in_browser') {
        loadUrl(decision.url);
        return;
      }

      if (decision.action === 'open_external') {
        const owningTabId = tabId ?? useBrowserStore.getState().activeTabId;
        void openIntentOrExternal(decision.url, {
          targetTabId: owningTabId,
          navigationEpoch: navId,
          controllerGeneration: webViewInstanceGenerationRef.current,
          currentPageUrl: tabUrl,
        });
      }
    },
    [loadUrl, navigationEpochRef, tabId, tabUrl, webViewInstanceGenerationRef],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const raw = event.nativeEvent.data;
      if (chromeBridge.handleChromeMessage(raw)) {
        return;
      }
      // Inactive parked tabs must not drive media/CTA for the active tab.
      if (!isActive) {
        return;
      }
      onMediaDetectionMessage(raw);
    },
    [chromeBridge, isActive, onMediaDetectionMessage],
  );

  const config = browserWebViewConfiguration;

  // Phase 6A: never pass `incognito` — Android setIncognito clears global CookieManager.
  return (
    <WebView
      ref={webViewRef}
      testID={testID}
      source={webViewSource}
      style={[styles.webview, { backgroundColor: theme.colors.background }]}
      {...(userAgent ? { userAgent } : {})}
      javaScriptEnabled={config.javaScriptEnabled}
      domStorageEnabled={config.domStorageEnabled}
      thirdPartyCookiesEnabled={config.thirdPartyCookiesEnabled}
      sharedCookiesEnabled={config.sharedCookiesEnabled}
      cacheEnabled={config.cacheEnabled}
      cacheMode={cacheMode}
      originWhitelist={[...config.originWhitelist]}
      allowFileAccess={config.allowFileAccess}
      allowFileAccessFromFileURLs={config.allowFileAccessFromFileURLs}
      allowUniversalAccessFromFileURLs={config.allowUniversalAccessFromFileURLs}
      mixedContentMode={config.mixedContentMode}
      geolocationEnabled={config.geolocationEnabled}
      allowsBackForwardNavigationGestures={config.allowsBackForwardNavigationGestures}
      allowsInlineMediaPlayback={config.allowsInlineMediaPlayback}
      mediaPlaybackRequiresUserAction={config.mediaPlaybackRequiresUserAction}
      setSupportMultipleWindows={config.setSupportMultipleWindows}
      javaScriptCanOpenWindowsAutomatically={config.javaScriptCanOpenWindowsAutomatically}
      startInLoadingState={config.startInLoadingState}
      scalesPageToFit={scalesPageToFit}
      setBuiltInZoomControls={config.setBuiltInZoomControls}
      setDisplayZoomControls={config.setDisplayZoomControls}
      pullToRefreshEnabled={pullToRefreshEnabled}
      injectedJavaScript={injectedJavaScript}
      injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
      onMessage={handleMessage}
      onNavigationStateChange={handleNavigationStateChange}
      onLoadStart={handleLoadStart}
      onLoadEnd={handleLoadEnd}
      onLoadProgress={handleProgress}
      onError={handleError}
      onHttpError={handleHttpError}
      onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      onContentProcessDidTerminate={handleContentProcessDidTerminate}
      onRenderProcessGone={handleRenderProcessGone}
      onOpenWindow={handleOpenWindow}
      accessibilityLabel={t('browser.webContentA11y')}
      accessibilityHint={
        pullToRefreshEnabled
          ? t('browser.pullToRefreshHint')
          : useBrowserStore.getState().isLoading
            ? t('browser.pageLoadingHint')
            : undefined
      }
      accessibilityRole="none"
      accessible
    />
  );
});

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
