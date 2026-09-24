import { useEffect, useRef } from 'react';

import { isBrowserHomeUrl } from '@/browser/utils';
import { useBrowserEngineContext } from '@/browser/engine';
import { selectBrowserError, useBrowserStore } from '@/browser/stores';
import { logBrowserMedia } from '@/browser/diagnostics';
import { browserMediaActionService } from '@/browser/media-actions';
import { tabControllerRegistry } from '@/browser/tabs/tab-controller-registry';

import { mediaDetectionEngine } from '../engine';
import { buildMediaDetectionRescanScript } from '../observers';
import { needsDetectionNavigationStart } from './detection-navigation-sync';

const RESCAN_SCRIPT = buildMediaDetectionRescanScript();

/**
 * Synchronizes browser navigation → media detection engine.
 * Passive: never mutates browserStore. Passes navigation epoch for stale guards.
 * Phase 3D: never flips Desktop Site — that belongs to chrome loadUrl / user menu only.
 */
export function useMediaDetectionBrowserSync(): void {
  const currentUrl = useBrowserStore((s) => s.currentUrl);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const isLoading = useBrowserStore((s) => s.isLoading);
  const browserError = useBrowserStore(selectBrowserError);
  // Re-renders on reload / same-URL load / tab switch; the controller ref holds the epoch native scopes use.
  const activeTabNavigationEpoch = useBrowserStore(
    (s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.navigationEpoch ?? null,
  );
  const { navigationEpochRef } = useBrowserEngineContext();
  const prevUrlRef = useRef<string | null>(null);
  const prevEpochRef = useRef<number | null>(null);
  const prevTabIdRef = useRef<string | null>(null);
  const prevLoadingRef = useRef<boolean | null>(null);

  useEffect(() => {
    mediaDetectionEngine.start();
    // The engine asks a tab's page to report its media again when its earlier reports went nowhere (another tab
    // was in front, or the Browser was hidden). A tab whose WebView is not mounted loads afresh anyway.
    mediaDetectionEngine.setRescanRequester((tabId) => {
      tabControllerRegistry.get(tabId)?.webViewRef.current?.injectJavaScript(RESCAN_SCRIPT);
    });
    return () => {
      // Host owns lifecycle — stop only when Host unmounts with the browser screen.
      mediaDetectionEngine.setRescanRequester(null);
      mediaDetectionEngine.stop();
    };
  }, []);

  useEffect(() => {
    if (activeTabId) {
      mediaDetectionEngine.setActiveTab(activeTabId);
    }
  }, [activeTabId]);

  useEffect(() => {
    if (isBrowserHomeUrl(currentUrl)) {
      if (prevUrlRef.current !== currentUrl || prevTabIdRef.current !== activeTabId) {
        mediaDetectionEngine.onGoHome(activeTabId ?? null);
        prevUrlRef.current = currentUrl;
        prevEpochRef.current = null;
        prevTabIdRef.current = activeTabId ?? null;
      }
      return;
    }

    const epoch = navigationEpochRef.current;
    if (
      needsDetectionNavigationStart(
        {
          url: prevUrlRef.current,
          epoch: prevEpochRef.current,
          tabId: prevTabIdRef.current,
        },
        { url: currentUrl, epoch, tabId: activeTabId ?? null },
      )
    ) {
      // Phase 3D: media sync must NEVER mutate Desktop mode.
      // Platform Desktop is applied only in chrome loadUrl BEFORE sourceUri.
      // Mid-nav / SPA Desktop flips abort WebView loads (historical TikTok timeout).
      mediaDetectionEngine.onNavigationStart(currentUrl, epoch, activeTabId);
      prevUrlRef.current = currentUrl;
      prevEpochRef.current = epoch;
      prevTabIdRef.current = activeTabId ?? null;
    }
  }, [currentUrl, navigationEpochRef, activeTabId, activeTabNavigationEpoch]);

  useEffect(() => {
    if (isBrowserHomeUrl(currentUrl)) {
      prevLoadingRef.current = isLoading;
      return;
    }

    if (prevLoadingRef.current === true && isLoading === false) {
      mediaDetectionEngine.onNavigationComplete(currentUrl);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, currentUrl]);

  useEffect(() => {
    if (!browserError) {
      return;
    }
    logBrowserMedia(navigationEpochRef.current, {
      event: 'cta_cleared',
      reason: 'browser_error',
    });
    mediaDetectionEngine.onBrowserError();
    browserMediaActionService.resetForNavigation(null);
  }, [browserError, navigationEpochRef]);
}
