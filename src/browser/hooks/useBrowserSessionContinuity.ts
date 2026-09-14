import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useBrowserEngineContext } from '@/browser/engine';
import { pendingNavigationService } from '@/browser/services';
import { browserSyncService } from '@/browser/services/browser-sync.service';
import {
  isRestorableBrowserUrl,
  phase6aSessionContinuityPolicy,
  readBrowserSession,
  resolveRestorableSessionUrl,
} from '@/browser/session';
import { scrollPositionService } from '@/browser/scroll';
import { selectIsHome, useBrowserStore } from '@/browser/stores';
import { isBrowserHomeUrl } from '@/browser/utils';
import { logBrowserSession } from '@/browser/diagnostics';
import { mediaDetectionEngine } from '@/media-detection';

/**
 * Session continuity: cold-start hydrate (async fallback) + background flush.
 * Synchronous MMKV hydrate happens in browserStore initial state.
 *
 * Phase 6A: restores tab/page URL metadata only — never cookies, tokens, or
 * credentials. Website auth state lives in Android WebView CookieManager.
 * Background flush must not remount WebViews or clear the cookie jar.
 */
export function useBrowserSessionContinuity(): void {
  const { loadUrl } = useBrowserEngineContext();
  const isHome = useBrowserStore(selectIsHome);
  const hydratedRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (hydratedRef.current) {
      return;
    }
    hydratedRef.current = true;

    logBrowserSession({
      sessionEvent: 'session_hydrate',
      sessionTransitionCategory: 'app_cold_start_url_hydrate',
      cookieSupportEnabled: true,
      cookieAuthority: phase6aSessionContinuityPolicy.cookieAuthority,
      sharedCookiesEnabled: phase6aSessionContinuityPolicy.sharedCookiesEnabledProp,
      androidSharedCookiesPropIsNoop:
        phase6aSessionContinuityPolicy.androidSharedCookiesPropIsNoop,
      thirdPartyCookiePolicy: phase6aSessionContinuityPolicy.thirdPartyCookiePolicy,
      thirdPartyCookiesEnabled: phase6aSessionContinuityPolicy.thirdPartyCookiesEnabled,
      domStorageEnabled: phase6aSessionContinuityPolicy.domStorageEnabled,
      incognitoEnabled: phase6aSessionContinuityPolicy.incognitoEnabled,
    });

    let cancelled = false;

    void (async () => {
      // Pending cross-screen navigation always wins.
      if (pendingNavigationService.peek()) {
        return;
      }

      const session = await readBrowserSession();
      if (cancelled) {
        return;
      }

      scrollPositionService.hydrateFromPersisted(session?.scrollPositions);

      const restorable = resolveRestorableSessionUrl(session);
      if (!restorable || !isRestorableBrowserUrl(restorable.url)) {
        return;
      }

      scrollPositionService.seed(restorable.url, restorable.scrollY);

      const state = useBrowserStore.getState();
      // Only async-restore when still on home (MMKV path already seeded URL).
      if (isBrowserHomeUrl(state.currentUrl)) {
        loadUrl(restorable.url);
        if (restorable.title) {
          useBrowserStore.getState().setPageTitle(restorable.title);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadUrl]);

  const handleAppState = useCallback(
    (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;

      if (next === 'background' || next === 'inactive') {
        browserSyncService.onAppBackground();
        mediaDetectionEngine.setAppActive(false);
        return;
      }

      if (
        next === 'active' &&
        (previous === 'background' || previous === 'inactive')
      ) {
        mediaDetectionEngine.setAppActive(true);
        if (!isHome) {
          // Continuity without flicker: flush only — do not remount or reload.
          browserSyncService.onAppBackground();
        }
      }
    },
    [isHome],
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [handleAppState]);
}
