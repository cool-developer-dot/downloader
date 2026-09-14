/**
 * Native adapters for orientation + system bars.
 * Imported by player chrome — not by Node verifiers.
 */

import { Platform, StatusBar } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import * as ScreenOrientation from 'expo-screen-orientation';
import { setStatusBarHidden } from 'expo-status-bar';

import { configureOrientationAdapter } from './orientation-controller';
import { configureSystemBarsAdapter } from './system-bars';

let bound = false;

export function ensurePlayerChromeRuntime(): void {
  if (bound) {
    return;
  }

  configureOrientationAdapter({
    lockLandscape: async () => {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    },
    lockPortrait: async () => {
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    },
    unlockAuto: async () => {
      await ScreenOrientation.unlockAsync();
    },
    restoreDefault: async () => {
      // App default is portrait (app.json orientation: portrait).
      await ScreenOrientation.lockAsync(
        ScreenOrientation.OrientationLock.PORTRAIT_UP,
      );
    },
  });

  configureSystemBarsAdapter({
    hide: async () => {
      setStatusBarHidden(true, 'fade');
      if (Platform.OS === 'android') {
        StatusBar.setHidden(true, 'fade');
        try {
          await NavigationBar.setVisibilityAsync('hidden');
        } catch {
          // ignore — some devices lack nav bar control
        }
      }
    },
    show: async () => {
      setStatusBarHidden(false, 'fade');
      if (Platform.OS === 'android') {
        StatusBar.setHidden(false, 'fade');
        try {
          await NavigationBar.setVisibilityAsync('visible');
        } catch {
          // ignore
        }
      }
    },
  });

  bound = true;
}

export function resetPlayerChromeRuntimeBinding(): void {
  bound = false;
}
