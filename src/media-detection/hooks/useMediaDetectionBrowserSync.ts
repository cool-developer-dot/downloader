import { useEffect, useRef } from 'react';

import { isBrowserHomeUrl } from '@/browser/utils';
import { useBrowserEngineContext } from '@/browser/engine';
import { selectBrowserError, useBrowserStore } from '@/browser/stores';
import { logBrowserMedia } from '@/browser/diagnostics';
import { browserMediaActionService } from '@/browser/media-actions';

import { mediaDetectionEngine } from '../engine';
import { isSameDocumentUrl } from '../utils';

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
  const { navigationEpochRef } = useBrowserEngineContext();
  const prevUrlRef = useRef<string | null>(null);
  const prevLoadingRef = useRef<boolean | null>(null);

  useEffect(() => {
    mediaDetectionEngine.start();
    return () => {
      // Host owns lifecycle — stop only when Host unmounts with the browser screen.
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
      if (prevUrlRef.current !== currentUrl) {
        mediaDetectionEngine.onGoHome();
        prevUrlRef.current = currentUrl;
      }
      return;
    }

    if (!isSameDocumentUrl(prevUrlRef.current, currentUrl)) {
      // Phase 3D: media sync must NEVER mutate Desktop mode.
      // Platform Desktop is applied only in chrome loadUrl BEFORE sourceUri.
      // Mid-nav / SPA Desktop flips abort WebView loads (historical TikTok timeout).
      mediaDetectionEngine.onNavigationStart(
        currentUrl,
        navigationEpochRef.current,
        activeTabId,
      );
      prevUrlRef.current = currentUrl;
    }
  }, [currentUrl, navigationEpochRef, activeTabId]);

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
