import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAppLockStore } from '@/security/app-lock';
import { selectInFlightDownloadCount, useDownloadsStore } from '@/store/downloads';

import { requestInAppReviewIfCalm, subscribeReviewCompletions } from './in-app-review';
import { isCalmRoute, REVIEW_ROUTE_SETTLE_MS } from './review-policy';

function isLocked(): boolean {
  const lock = useAppLockStore.getState();
  return lock.isEnabled && lock.status !== 'UNLOCKED';
}

/**
 * Asks Google Play for its in-app review sheet at a calm moment after successful downloads — never while something
 * downloads, never over the player, never mid-navigation or over App Lock. Renders nothing. Mounted once, inside the
 * App Lock gate, so it only runs while the private UI is showing.
 */
export function ReviewPromptHost(): null {
  const pathname = usePathname();
  const inFlight = useDownloadsStore(selectInFlightDownloadCount);
  const locked = useAppLockStore((state) => state.isEnabled && state.status !== 'UNLOCKED');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [completions, setCompletions] = useState(0);

  /** When the current route started showing, and which route that is (read by the timer, not by render). */
  const route = useRef({ pathname, since: 0 });

  useEffect(() => {
    route.current = { pathname, since: Date.now() };
  }, [pathname]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => subscribeReviewCompletions(() => setCompletions((n) => n + 1)), []);

  useEffect(() => {
    if (!appActive || locked || inFlight > 0 || !isCalmRoute(pathname)) {
      return;
    }
    // Wait until the user has stayed on the list for a moment; any change re-arms this timer.
    const wait = Math.max(0, REVIEW_ROUTE_SETTLE_MS - (Date.now() - route.current.since)) + 100;
    const timer = setTimeout(() => {
      // Everything is read again at fire time: the moment must still be calm now, not when the timer was set.
      void requestInAppReviewIfCalm({
        appActive: AppState.currentState === 'active',
        appLocked: isLocked(),
        inFlightDownloads: selectInFlightDownloadCount(useDownloadsStore.getState()),
        pathname: route.current.pathname,
        routeStableMs: Date.now() - route.current.since,
      }).catch(() => undefined);
    }, wait);
    return () => clearTimeout(timer);
  }, [appActive, completions, inFlight, locked, pathname]);

  return null;
}
