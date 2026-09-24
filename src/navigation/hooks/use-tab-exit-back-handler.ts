import { usePathname } from 'expo-router';
import { useCallback, useRef } from 'react';
import { BackHandler, ToastAndroid, Platform } from 'react-native';

import { routePaths } from '../constants/route-paths';

import { BACK_PRIORITY } from './back-handler-registry';
import { useAndroidBackHandler } from './use-android-back-handler';

const EXIT_INTERVAL_MS = 2_000;

/**
 * Double-press-to-exit on the landing tab.
 *
 * Registered at the lowest priority so it only ever sees a Back press that the
 * focused screen (e.g. the Browser's page history) declined. Consuming Back
 * unconditionally here is what made Back look stuck on the Browser tab.
 */
export function useTabExitBackHandler(enabled = true): void {
  const pathname = usePathname();
  const lastBackPressAt = useRef(0);
  // Phase 1: Browser is the default landing tab (Home removed from visible tabs).
  const shouldHandleExit = enabled && pathname === routePaths.browser;

  const handleBackPress = useCallback(() => {
    const now = Date.now();

    if (now - lastBackPressAt.current < EXIT_INTERVAL_MS) {
      BackHandler.exitApp();
      return true;
    }

    lastBackPressAt.current = now;

    if (Platform.OS === 'android') {
      ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
    }

    return true;
  }, []);

  useAndroidBackHandler({
    enabled: shouldHandleExit,
    onBackPress: handleBackPress,
    priority: BACK_PRIORITY.appExit,
  });
}
