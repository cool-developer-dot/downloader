import { useCallback, useMemo, useRef } from 'react';
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewNavigation,
  WebViewProgressEvent,
  WebViewRenderProcessGoneEvent,
  WebViewTerminatedEvent,
} from 'react-native-webview/lib/WebViewTypes';

import { BROWSER_WEBVIEW_BLANK } from '@/browser/constants';
import { useBrowserEngineContext } from '@/browser/engine';
import {
  browserSyncService,
  goBackWebView,
  navigationService,
  recordSuccessfulVisit,
} from '@/browser/services';
import { scrollPositionService } from '@/browser/scroll';
import { useBrowserStore } from '@/browser/stores';
import {
  classifyBrowserLoadError,
  logBrowserError,
  logBrowserHistory,
  logBrowserLoad,
  logBrowserNav,
  logBrowserSsl,
  sanitizeBrowserUrl,
} from '@/browser/diagnostics';
import {
  createBrowserErrorFromClassification,
  resolveBrowserRetryUrl,
} from '@/browser/services/browser-failure.service';
import {
  classifyWebViewLoadError,
  isBrowserHomeUrl,
  isValidBrowserPageUrl,
} from '@/browser/utils';
import { isIntentScheme, openIntentOrExternal } from '@/browser/navigation/external-navigation.service';
import type { IntentNavigationContext } from '@/browser/navigation/external-navigation.service';
import { classifyBrowserNavigation } from '@/browser/navigation/browser-navigation-policy';
import { mediaDetectionEngine } from '@/media-detection';
import { useHistoryStore } from '@/store/history';

/** Compare main-document URLs ignoring hash (subresource errors use different paths). */
function isSameDocumentNavigationUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = '';
    right.hash = '';
    return left.href === right.href;
  } catch {
    return a.trim() === b.trim();
  }
}

export type BrowserEngineEventBridge = {
  onNavigationStateChange: (navState: WebViewNavigation) => void;
  onLoadStart: (url: string) => void;
  onLoadEnd: (url: string) => void;
  onLoadProgress: (event: WebViewProgressEvent) => void;
  onError: (event: WebViewErrorEvent) => void;
  onHttpError: (event: WebViewHttpErrorEvent) => void;
  onContentProcessDidTerminate: (event: WebViewTerminatedEvent) => void;
  onRenderProcessGone: (event: WebViewRenderProcessGoneEvent) => void;
  onShouldStartLoadWithRequest: (request: ShouldStartLoadRequest) => boolean;
};

/**
 * Synchronizes WebView lifecycle events into browserStore.
 * Used exclusively by BrowserContainer — no UI chrome should subscribe here.
 */
export function useBrowserEngineEvents(): BrowserEngineEventBridge {
  const {
    tabId,
    loadUrl,
    goHome,
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
  } = useBrowserEngineContext();
  /** Bounded render-process recovery attempts per navigation generation. */
  const renderRecoveryAttemptRef = useRef(0);
  /** Throttle high-frequency onLoadProgress → Zustand writes. */
  const lastProgressWriteAtRef = useRef(0);
  const lastProgressValueRef = useRef(0);

  const markVisited = useBrowserStore((state) => state.markVisited);
  const updateTab = useBrowserStore((state) => state.updateTab);

  /** True when this controller generation is still the live mount for tabId. */
  const isLiveGeneration = useCallback(() => {
    // Sync callbacks always match; bumped on unregister cancels late async work.
    return webViewInstanceGenerationRef.current > 0;
  }, [webViewInstanceGenerationRef]);

  const withOwningTabGuard = useCallback(
    (fn: () => void) => {
      if (!isLiveGeneration()) {
        return;
      }
      const gen = webViewInstanceGenerationRef.current;
      fn();
      // Detect sync unregister mid-callback (close/evict).
      if (webViewInstanceGenerationRef.current !== gen) {
        return;
      }
    },
    [isLiveGeneration, webViewInstanceGenerationRef],
  );

  /** Owning-tab snapshot — never read active chrome mirrors for decisioning. */
  const getOwningTabChrome = useCallback(() => {
    const state = useBrowserStore.getState();
    if (!tabId) {
      return {
        url: state.currentUrl,
        title: state.pageTitle,
        loading: state.isLoading,
        error: state.error,
      };
    }
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) {
      return {
        url: state.currentUrl,
        title: state.pageTitle,
        loading: state.isLoading,
        error: state.error,
      };
    }
    return {
      url: tab.url,
      title: tab.title,
      loading: tab.loading,
      error: tab.error,
    };
  }, [tabId]);

  /**
   * Always patch the owning tab. updateTab mirrors global chrome only when
   * tabId === activeTabId at apply time (no TOCTOU via patchActiveTab).
   */
  const applyNavigationState = useCallback(
    (snapshot: {
      url: string;
      title: string;
      canGoBack: boolean;
      canGoForward: boolean;
      loading: boolean;
    }) => {
      withOwningTabGuard(() => {
        if (!tabId) {
          useBrowserStore.getState().applyNavigationState(snapshot);
          return;
        }
        const owning = getOwningTabChrome();
        if (isBrowserHomeUrl(owning.url) && snapshot.url === 'about:blank') {
          return;
        }
        const url = isBrowserHomeUrl(snapshot.url) ? owning.url : snapshot.url;
        updateTab(tabId, {
          url,
          title: snapshot.title || owning.title,
          canGoBack: snapshot.canGoBack,
          canGoForward: snapshot.canGoForward,
          loading: snapshot.loading,
        });
      });
    },
    [getOwningTabChrome, tabId, updateTab, withOwningTabGuard],
  );

  const setLoading = useCallback(
    (isLoading: boolean) => {
      withOwningTabGuard(() => {
        if (!tabId) {
          useBrowserStore.getState().setLoading(isLoading);
          return;
        }
        updateTab(tabId, { loading: isLoading });
      });
    },
    [tabId, updateTab, withOwningTabGuard],
  );

  const setProgress = useCallback(
    (progress: number) => {
      withOwningTabGuard(() => {
        if (!tabId) {
          useBrowserStore.getState().setProgress(progress);
          return;
        }
        updateTab(tabId, { progress });
      });
    },
    [tabId, updateTab, withOwningTabGuard],
  );

  const setPageTitle = useCallback(
    (title: string) => {
      withOwningTabGuard(() => {
        if (!tabId) {
          useBrowserStore.getState().setPageTitle(title);
          return;
        }
        updateTab(tabId, { title });
      });
    },
    [tabId, updateTab, withOwningTabGuard],
  );

  const setError = useCallback(
    (error: import('@/browser/types').BrowserErrorState | null) => {
      withOwningTabGuard(() => {
        if (!tabId) {
          useBrowserStore.getState().setError(error);
          return;
        }
        updateTab(tabId, { error, loading: false, progress: 0 });
      });
    },
    [tabId, updateTab, withOwningTabGuard],
  );

  const clearError = useCallback(() => {
    withOwningTabGuard(() => {
      if (!tabId) {
        useBrowserStore.getState().clearError();
        return;
      }
      updateTab(tabId, { error: null });
    });
  }, [tabId, updateTab, withOwningTabGuard]);

  const isStaleEvent = useCallback(() => {
    return loadStartEpochRef.current !== navigationEpochRef.current;
  }, [loadStartEpochRef, navigationEpochRef]);

  /**
   * Stale-error ownership:
   * - Epoch mismatch alone is insufficient: chrome loadUrl seeds loadStartEpoch,
   *   but native onError can still race ahead of onLoadStart on some Android paths.
   * - Correlate by intentional load URL / committed URL when native url is missing.
   */
  const isStaleMainFrameError = useCallback(
    (failingUrl: string | null | undefined): boolean => {
      const owning = getOwningTabChrome();
      const intentionalUrl = loadStartUrlRef.current ?? owning.url;
      const epochMatches = loadStartEpochRef.current === navigationEpochRef.current;

      const matchesIntent = (candidate: string | null | undefined): boolean => {
        if (!candidate || !intentionalUrl) {
          return false;
        }
        if (isBrowserHomeUrl(intentionalUrl)) {
          return false;
        }
        return isSameDocumentNavigationUrl(candidate, intentionalUrl);
      };

      if (!failingUrl) {
        // Domain: undefined — accept for the intentional main-frame load on THIS tab.
        if (isBrowserHomeUrl(owning.url) && !loadStartUrlRef.current) {
          return true;
        }
        return !(epochMatches || Boolean(loadStartUrlRef.current));
      }

      if (matchesIntent(failingUrl) || isSameDocumentNavigationUrl(failingUrl, owning.url)) {
        return false;
      }

      if (epochMatches) {
        const startedUrl = loadStartUrlRef.current;
        if (startedUrl && isSameDocumentNavigationUrl(failingUrl, startedUrl)) {
          return false;
        }
        // Epoch matches but URL does not belong to this document → subresource-like noise.
        return true;
      }

      return true;
    },
    [getOwningTabChrome, loadStartEpochRef, loadStartUrlRef, navigationEpochRef],
  );

  const onNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      if (!navState.url) {
        return;
      }

      const navId = navigationEpochRef.current;
      const urlMeta = sanitizeBrowserUrl(navState.url);
      logBrowserNav(navId, navState.loading ? 'commit' : 'redirect', {
        safeHost: urlMeta.safeHost,
        safePathPattern: urlMeta.safePathPattern,
        isLoading: navState.loading,
        canGoBack: navState.canGoBack,
        canGoForward: navState.canGoForward,
      });

      if (navState.url === 'about:blank') {
        if (isBrowserHomeUrl(getOwningTabChrome().url)) {
          return;
        }

        // User Back walked off the front of page history into the about:blank
        // the WebView was seeded with. Treating that as a transient blank left
        // a blank document under a stale URL with Back still armed and inert —
        // the tab could only be recovered by opening a new one.
        if (pendingNativeBackRef.current) {
          pendingNativeBackRef.current = false;
          logBrowserNav(navId, 'back', {
            decisionReason: 'back_reached_blank_seed',
            strategy: 'home_fallback',
            tabId,
          });
          nativeCanGoBackRef.current = false;
          nativeCanGoForwardRef.current = false;
          goHome();
          browserSyncService.onGoHome();
          return;
        }

        // Transient blank during UA/source transitions while a real page is committed.
        // Must NOT goHome — that aborted TikTok loads after platform Desktop flip.
        if (
          sourceUri &&
          sourceUri !== BROWSER_WEBVIEW_BLANK &&
          !isBrowserHomeUrl(sourceUri)
        ) {
          logBrowserNav(navId, 'redirect', {
            decisionReason: 'ignore_transient_blank',
            safeHost: sanitizeBrowserUrl(sourceUri).safeHost,
            isLoading: navState.loading,
          });
          return;
        }

        // Leftover blank behind a real page — prefer WebView back, else Home.
        if (navState.canGoBack) {
          goBackWebView(webViewRef.current);
          return;
        }
        if (chromeNavRef.current.index > 0) {
          // Legacy chrome stack entry — prefer Home over sourceUri remount loops.
          goHome();
          browserSyncService.onGoHome();
          return;
        }

        goHome();
        browserSyncService.onGoHome();
        return;
      }

      // A real document committed — the Back that was in flight landed on a page.
      pendingNativeBackRef.current = false;

      const owning = getOwningTabChrome();
      if (isBrowserHomeUrl(owning.url)) {
        return;
      }

      // Ignore COMPLETED navigations for a superseded chrome epoch only.
      // Do NOT early-return merely because a redirect final URL differs from the
      // chrome-seeded URL — that dropped loading=false and left Instagram/TikTok
      // spinners spinning when onLoadEnd was delayed.
      if (
        owning.loading &&
        !navState.loading &&
        isStaleEvent() &&
        !isSameDocumentNavigationUrl(navState.url, owning.url)
      ) {
        return;
      }

      if (
        isStaleEvent() &&
        !navState.loading &&
        !isSameDocumentNavigationUrl(navState.url, owning.url)
      ) {
        return;
      }

      nativeCanGoBackRef.current = Boolean(navState.canGoBack);
      nativeCanGoForwardRef.current = Boolean(navState.canGoForward);

      /**
       * Canonical loading ownership:
       * - Only chrome loadUrl / reload / onLoadStart may turn loading ON.
       * - navigationState.loading=true must NEVER re-arm the spinner after the
       *   top-level document finished (iframes, SPA soft events, late commits).
       * - navigationState.loading=false may clear while a load is still marked active.
       */
      const nextLoading = owning.loading
        ? Boolean(navState.loading)
        : false;

      applyNavigationState({
        url: navState.url,
        title: navState.title ?? '',
        canGoBack: Boolean(navState.canGoBack),
        canGoForward: Boolean(navState.canGoForward),
        loading: nextLoading,
      });

      if (navState.title) {
        setPageTitle(navState.title);
      }

      // Session MMKV belongs to the active tab only — parked WebViews must not overwrite it.
      // Use intentional chrome navigation (owning.loading), not perpetual navState.loading.
      if (owning.loading) {
        const activeId = useBrowserStore.getState().activeTabId;
        if (!tabId || tabId === activeId) {
          browserSyncService.onNavigate(navState.url, navState.title ?? undefined);
        }
      }
    },
    [
      applyNavigationState,
      chromeNavRef,
      getOwningTabChrome,
      goHome,
      isStaleEvent,
      nativeCanGoBackRef,
      nativeCanGoForwardRef,
      pendingNativeBackRef,
      setPageTitle,
      sourceUri,
      tabId,
      webViewRef,
    ],
  );

  const onLoadStart = useCallback(
    (url: string) => {
      loadStartEpochRef.current = navigationEpochRef.current;
      if (url && url !== 'about:blank') {
        loadStartUrlRef.current = url;
      }
      const navId = navigationEpochRef.current;
      const urlMeta = sanitizeBrowserUrl(url);

      if (isBrowserHomeUrl(getOwningTabChrome().url)) {
        return;
      }
      if (url === 'about:blank') {
        return;
      }

      logBrowserLoad(navId, 'start', {
        safeHost: urlMeta.safeHost,
        safePathPattern: urlMeta.safePathPattern,
        webViewMounted: true,
      });

      // Do NOT clearError here. After ERR_TIMED_OUT Android may fire onLoadStart
      // for the Chromium error document; clearing would expose Domain: undefined.
      // Intentional navigations clear via loadUrl / reload / goHome.
      setLoading(true);
      lastProgressWriteAtRef.current = 0;
      lastProgressValueRef.current = 0;
      scrollPositionService.resetRestoreGuard(tabId);
      // URL commits come from navigation state / chrome loadUrl — avoid racing setCurrentUrl here.
    },
    [
      getOwningTabChrome,
      loadStartEpochRef,
      loadStartUrlRef,
      navigationEpochRef,
      setLoading,
      tabId,
    ],
  );

  const clearTopLevelLoading = useCallback(
    (reason: 'load_end' | 'progress_complete' | 'home') => {
      setLoading(false);
      if (reason === 'load_end' || reason === 'progress_complete') {
        setProgress(1);
      } else {
        setProgress(0);
      }
    },
    [setLoading, setProgress],
  );

  const onLoadEnd = useCallback(
    (url: string) => {
      const owning = getOwningTabChrome();
      const state = useBrowserStore.getState();

      if (isBrowserHomeUrl(owning.url)) {
        clearTopLevelLoading('home');
        return;
      }

      // Transient blank must not leave the prior document's spinner spinning.
      if (url === 'about:blank') {
        if (owning.loading && !isStaleEvent()) {
          clearTopLevelLoading('load_end');
        }
        return;
      }

      // Stale completion from a superseded chrome navigation — do not clear the active load.
      if (isStaleEvent()) {
        return;
      }

      // Commit final URL when redirect/normalize differs from chrome-seeded URL.
      if (
        owning.loading &&
        !isSameDocumentNavigationUrl(url, owning.url) &&
        isValidBrowserPageUrl(url)
      ) {
        applyNavigationState({
          url,
          title: owning.title,
          canGoBack: state.tabs.find((t) => t.id === tabId)?.canGoBack ?? state.canGoBack,
          canGoForward:
            state.tabs.find((t) => t.id === tabId)?.canGoForward ?? state.canGoForward,
          loading: false,
        });
      } else {
        clearTopLevelLoading('load_end');
      }

      // Guarantee spinner OFF for the current epoch even if applyNavigationState was used.
      if (getOwningTabChrome().loading) {
        clearTopLevelLoading('load_end');
      } else {
        setProgress(1);
      }

      const urlMeta = sanitizeBrowserUrl(url);
      logBrowserLoad(navigationEpochRef.current, 'end', {
        safeHost: urlMeta.safeHost,
        isLoading: false,
        webViewMounted: true,
      });

      const committedUrl = getOwningTabChrome().url;
      const isCommittedDocument =
        url === committedUrl || isSameDocumentNavigationUrl(url, committedUrl);

      if (isCommittedDocument) {
        renderRecoveryAttemptRef.current = 0;
        markVisited();

        const owningAfter = getOwningTabChrome();
        if (!owningAfter.error && !state.incognito) {
          const activeId = useBrowserStore.getState().activeTabId;
          if (!tabId || tabId === activeId) {
            browserSyncService.onSuccessfulPage(committedUrl, owningAfter.title);
          }

          // History recording lives outside BrowserContainer — fire after a successful load.
          const visitGen = webViewInstanceGenerationRef.current;
          void recordSuccessfulVisit({
            url: committedUrl,
            title: owningAfter.title,
            hasError: false,
          }).then((entry) => {
            if (webViewInstanceGenerationRef.current !== visitGen) {
              return;
            }
            if (entry) {
              logBrowserHistory({
                event: 'recorded',
                safeHost: sanitizeBrowserUrl(committedUrl).safeHost,
              });
              useHistoryStore.getState().prependOrUpdate(entry);
              if (!tabId || tabId === useBrowserStore.getState().activeTabId) {
                browserSyncService.invalidateSuggestionIntelligence();
              }
            }
          });

          // Scroll restore only after a successful, fully loaded document.
          scrollPositionService.scheduleRestore({
            webView: webViewRef.current,
            url: committedUrl,
            epoch: navigationEpochRef.current,
            tabId,
          });
        }
      }
    },
    [
      applyNavigationState,
      clearTopLevelLoading,
      getOwningTabChrome,
      isStaleEvent,
      markVisited,
      navigationEpochRef,
      setProgress,
      tabId,
      webViewInstanceGenerationRef,
      webViewRef,
    ],
  );

  const onLoadProgress = useCallback(
    (event: WebViewProgressEvent) => {
      if (isBrowserHomeUrl(getOwningTabChrome().url)) {
        return;
      }
      if (isStaleEvent()) {
        return;
      }

      const raw = event.nativeEvent.progress;
      // Always publish near-complete ticks so the bar can finish smoothly.
      if (raw >= 0.99) {
        lastProgressWriteAtRef.current = Date.now();
        lastProgressValueRef.current = raw;
        setProgress(raw);
        logBrowserLoad(navigationEpochRef.current, 'progress', {
          progressBucket: 'complete',
          progress: raw,
        });
        // Progress reaching completion is top-level document evidence — clear spinner
        // even if a late/mismatched onLoadEnd is delayed (never use wall-clock timeout).
        if (getOwningTabChrome().loading) {
          setLoading(false);
        }
        return;
      }

      const now = Date.now();
      const elapsed = now - lastProgressWriteAtRef.current;
      const delta = raw - lastProgressValueRef.current;
      // Coalesce micro-updates: keep visual smoothness without flooding subscribers.
      if (elapsed < 50 && delta < 0.02) {
        return;
      }

      lastProgressWriteAtRef.current = now;
      lastProgressValueRef.current = raw;
      setProgress(raw);

      const bucket =
        raw < 0.25 ? '0-25' : raw < 0.5 ? '25-50' : raw < 0.75 ? '50-75' : '75-99';
      logBrowserLoad(navigationEpochRef.current, 'progress', {
        progressBucket: bucket,
        progress: raw,
      });
    },
    [getOwningTabChrome, isStaleEvent, navigationEpochRef, setLoading, setProgress],
  );

  const onError = useCallback(
    (event: WebViewErrorEvent) => {
      const owning = getOwningTabChrome();
      if (isBrowserHomeUrl(owning.url)) {
        return;
      }

      const { description, url, code } = event.nativeEvent;
      const failingUrl = typeof url === 'string' ? url.trim() : null;
      const navId = navigationEpochRef.current;

      if (isStaleMainFrameError(failingUrl)) {
        logBrowserError(navId, {
          safeHost: sanitizeBrowserUrl(failingUrl ?? undefined).safeHost,
          errorCode: code,
          safeDescription: (description ?? '').slice(0, 160),
          mainFrame: true,
          staleDropped: true,
          classification: classifyBrowserLoadError({ description, code }),
        });
        return;
      }

      const safeDescription = description || `Failed to load page (${code})`;
      const classification = classifyBrowserLoadError({
        description: safeDescription,
        code,
      });

      if (classification === 'aborted' && suppressNextAbortErrorRef.current) {
        suppressNextAbortErrorRef.current = false;
        logBrowserError(navId, {
          errorCode: code,
          classification,
          userInitiatedAbort: true,
          mainFrame: true,
        });
        return;
      }

      const urlMeta = sanitizeBrowserUrl(failingUrl ?? owning.url);

      logBrowserError(navId, {
        safeHost: urlMeta.safeHost,
        errorCode: code,
        safeDescription: safeDescription.slice(0, 160),
        mainFrame: true,
        currentUrlKnown: Boolean(failingUrl),
        classification,
        recoverable: true,
        retryAvailable: Boolean(
          resolveBrowserRetryUrl({
            failingUrl,
            loadStartUrl: loadStartUrlRef.current,
            committedUrl: owning.url,
          }),
        ),
      });

      if (classification === 'ssl') {
        logBrowserSsl(navId, {
          safeHost: urlMeta.safeHost,
          certificateErrorType: safeDescription.slice(0, 80),
          blocked: true,
        });
      }

      setError(
        classifyWebViewLoadError({
          description: safeDescription,
          code,
          url: failingUrl,
          navigationId: navId,
          loadStartUrl: loadStartUrlRef.current,
          committedUrl: owning.url,
        }),
      );
      if (!tabId || tabId === useBrowserStore.getState().activeTabId) {
        browserSyncService.onError();
      }
    },
    [
      getOwningTabChrome,
      isStaleMainFrameError,
      loadStartUrlRef,
      navigationEpochRef,
      setError,
      suppressNextAbortErrorRef,
      tabId,
    ],
  );

  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => {
      const owning = getOwningTabChrome();
      if (isBrowserHomeUrl(owning.url)) {
        return;
      }
      if (isStaleEvent()) {
        return;
      }
      const { statusCode, url, description } = event.nativeEvent;
      if (statusCode < 400) {
        return;
      }

      // Ignore subresource HTTP errors (favicon, ads, CDN) — only fail THIS tab's document.
      const errorUrl = typeof url === 'string' ? url.trim() : '';
      if (!errorUrl || !isSameDocumentNavigationUrl(errorUrl, owning.url)) {
        return;
      }

      const urlMeta = sanitizeBrowserUrl(errorUrl);
      logBrowserError(navigationEpochRef.current, {
        safeHost: urlMeta.safeHost,
        errorCode: statusCode,
        safeDescription: (description || `HTTP ${statusCode}`).slice(0, 160),
        mainFrame: true,
        currentUrlKnown: true,
        classification: 'http',
      });

      setError(
        createBrowserErrorFromClassification({
          navigationId: navigationEpochRef.current,
          classification: 'http',
          source: 'webview_http',
          failingUrl: errorUrl,
          loadStartUrl: loadStartUrlRef.current,
          committedUrl: owning.url,
          errorCode: statusCode,
          mainFrame: true,
          statusCode,
        }),
      );
      if (!tabId || tabId === useBrowserStore.getState().activeTabId) {
        browserSyncService.onError();
      }
    },
    [getOwningTabChrome, isStaleEvent, loadStartUrlRef, navigationEpochRef, setError, tabId],
  );

  const recoverFromProcessTermination = useCallback(() => {
    const owning = getOwningTabChrome();
    const url = owning.url;
    const navId = navigationEpochRef.current;

    if (
      !isBrowserHomeUrl(url) &&
      renderRecoveryAttemptRef.current < 1 &&
      isValidBrowserPageUrl(url)
    ) {
      renderRecoveryAttemptRef.current += 1;
      logBrowserError(navId, {
        classification: 'render_process',
        renderRecoveryAttempt: renderRecoveryAttemptRef.current,
        recoverable: true,
        safeHost: sanitizeBrowserUrl(url).safeHost,
      });
      clearError();
      loadUrl(url);
      return;
    }

    renderRecoveryAttemptRef.current = 0;
    if (isBrowserHomeUrl(url)) {
      goHome();
      return;
    }

    setError(
      createBrowserErrorFromClassification({
        navigationId: navId,
        classification: 'render_process',
        source: 'render_process',
        failingUrl: url,
        loadStartUrl: loadStartUrlRef.current,
        committedUrl: url,
        mainFrame: true,
        renderRecoveryAttempt: 1,
      }),
    );
  }, [
    clearError,
    getOwningTabChrome,
    goHome,
    loadStartUrlRef,
    loadUrl,
    navigationEpochRef,
    setError,
  ]);

  const onContentProcessDidTerminate = useCallback(
    (_event: WebViewTerminatedEvent) => {
      recoverFromProcessTermination();
    },
    [recoverFromProcessTermination],
  );

  const onRenderProcessGone = useCallback(
    (_event: WebViewRenderProcessGoneEvent) => {
      recoverFromProcessTermination();
    },
    [recoverFromProcessTermination],
  );

  const onShouldStartLoadWithRequest = useCallback((request: ShouldStartLoadRequest) => {
    const { url } = request;
    const navId = navigationEpochRef.current;
    const urlMeta = sanitizeBrowserUrl(url);
    const isMainFrame = request.mainDocumentURL
      ? request.mainDocumentURL === url || request.url === url
      : request.isTopFrame !== false;

    logBrowserNav(navId, 'request', {
      safeHost: urlMeta.safeHost,
      safePathPattern: urlMeta.safePathPattern,
      mainFrame: isMainFrame,
      navigationType: request.navigationType,
    });

    if (!url || url === 'about:blank') {
      logBrowserNav(navId, 'allow', { decisionReason: 'blank_document' });
      return true;
    }

    if (isBrowserHomeUrl(url)) {
      logBrowserNav(navId, 'block', {
        decision: false,
        decisionReason: 'home_url_intercept',
      });
      return false;
    }

    const decision = classifyBrowserNavigation(url);

    if (decision.kind === 'BLOCK_NATIVE_APP' || decision.kind === 'BLOCK_MARKET' || decision.kind === 'BLOCK_UNKNOWN_SCHEME' || decision.kind === 'BLOCK_DANGEROUS') {
      logBrowserNav(navId, 'block', {
        decision: false,
        decisionReason: decision.reason,
        safeHost: urlMeta.safeHost,
        schemeClass: decision.kind,
      });
      return false;
    }

    if (decision.kind === 'INTENT_WEB_FALLBACK' || decision.kind === 'INTENT_BLOCK' || isIntentScheme(url)) {
      logBrowserNav(navId, decision.kind === 'INTENT_WEB_FALLBACK' ? 'external' : 'block', {
        safeHost: urlMeta.safeHost,
        decisionReason: decision.reason,
        tabId,
      });
      const owningTabId = tabId ?? useBrowserStore.getState().activeTabId;
      if (owningTabId) {
        const intentContext: IntentNavigationContext = {
          targetTabId: owningTabId,
          navigationEpoch: navId,
          controllerGeneration: webViewInstanceGenerationRef.current,
          currentPageUrl: getOwningTabChrome().url,
        };
        void openIntentOrExternal(url, intentContext);
      }
      return false;
    }

    if (decision.kind === 'SAFE_SYSTEM_ACTION') {
      logBrowserNav(navId, 'external', {
        safeHost: urlMeta.safeHost,
        decisionReason: decision.reason,
      });
      void openIntentOrExternal(url);
      return false;
    }

    if (!decision.shouldLoadInWebView) {
      logBrowserNav(navId, 'block', {
        decision: false,
        decisionReason: decision.reason,
      });
      return false;
    }

    // Passive media observation — never changes allow/deny policy.
    // Active tab only: parked WebViews must not feed the global detection store.
    const pageUrl = getOwningTabChrome().url;
    const activeId = useBrowserStore.getState().activeTabId;
    if (
      (!tabId || tabId === activeId) &&
      !isBrowserHomeUrl(pageUrl) &&
      /\.(mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|mp3|m4a|aac|ogg|m3u8|mpd|3gp|3g2|flv|wmv)(?:[?#]|$)/i.test(url)
    ) {
      mediaDetectionEngine.observeUrl(url, pageUrl);
    }

    if (!navigationService.shouldHandleInBrowser(url)) {
      const intent = navigationService.classify(url);
      if (intent.kind !== 'blocked') {
        logBrowserNav(navId, 'external', {
          safeHost: urlMeta.safeHost,
          decisionReason: intent.kind,
        });
        void navigationService.openExternal(url);
      } else {
        logBrowserNav(navId, 'block', {
          decision: false,
          decisionReason: 'blocked_scheme',
        });
      }
      return false;
    }

    logBrowserNav(navId, 'allow', { decision: true, decisionReason: 'http_https' });
    return true;
  }, [getOwningTabChrome, navigationEpochRef, tabId, webViewInstanceGenerationRef]);

  return useMemo(
    () => ({
      onNavigationStateChange,
      onLoadStart,
      onLoadEnd,
      onLoadProgress,
      onError,
      onHttpError,
      onContentProcessDidTerminate,
      onRenderProcessGone,
      onShouldStartLoadWithRequest,
    }),
    [
      onNavigationStateChange,
      onLoadStart,
      onLoadEnd,
      onLoadProgress,
      onError,
      onHttpError,
      onContentProcessDidTerminate,
      onRenderProcessGone,
      onShouldStartLoadWithRequest,
    ],
  );
}
