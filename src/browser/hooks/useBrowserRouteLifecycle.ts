import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

import { logBrowserWebView } from '@/browser/diagnostics';
import { useBrowserStore } from '@/browser/stores';
import { setBrowserRouteVisible } from '@/browser/webview/webview-activity';
import { mediaDetectionEngine } from '@/media-detection';

/**
 * Browser route visibility → WebView + detection lifecycle.
 *
 * Bottom tabs keep the Browser screen mounted after its first visit, so every
 * parked WebView stayed live while the user was on Downloads / Player: still
 * running page JS, still streaming DOM mutation batches into the detection
 * engine, still writing progress into the store. That contention is what made
 * leaving the Browser feel like a freeze.
 *
 * On blur the pool is clamped to the active tab (parked WebViews unmount, their
 * in-flight verification is cancelled by the store) and the engine's
 * high-frequency rescan path is paused. The active tab's WebView stays mounted
 * but is paused natively (its page is hidden: no playback, no frames) until the
 * Browser is back in front. Open tabs, history and bookmarks are untouched.
 */
export function useBrowserRouteLifecycle(): void {
  useFocusEffect(
    useCallback(() => {
      mediaDetectionEngine.setBrowserVisible(true);
      setBrowserRouteVisible(true);

      return () => {
        mediaDetectionEngine.setBrowserVisible(false);
        setBrowserRouteVisible(false);
        const before = useBrowserStore.getState().mountedTabIds.length;
        useBrowserStore.getState().setMountBudget(1);
        const after = useBrowserStore.getState().mountedTabIds.length;
        if (after !== before) {
          logBrowserWebView({
            event: 'unmount',
            decisionReason: 'browser_route_blurred',
            mountedBefore: before,
            mountedAfter: after,
          });
        }
      };
    }, []),
  );
}
