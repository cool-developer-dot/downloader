import { usePathname } from 'expo-router';
import { useCallback, useRef } from 'react';
import { BackHandler, ToastAndroid, Platform } from 'react-native';

import { routePaths } from '../constants/route-paths';

import { useAndroidBackHandler } from './use-android-back-handler';

const EXIT_INTERVAL_MS = 2_000;

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

  useAndroidBackHandler({ enabled: shouldHandleExit, onBackPress: handleBackPress });
}
