import { Appearance } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web/src/VidoraWebModule';

import { nightModeOf, type ThemePreference } from '@/theme/theme-preference';

/**
 * Applies the user's theme preference to React Native's Appearance API and to Android itself.
 *
 * Dark and Midnight are the night themes; Light, Red, Cream and Blush paint on the light native scheme.
 * Android also records the choice (VidoraWeb `setAppNightMode`) so the next launch — the system splash on
 * Android 12+, the first activity frame everywhere — is already in the right theme before JavaScript runs.
 */
export function applyNativeColorScheme(mode: ThemePreference): void {
  const night = nightModeOf(mode);
  try {
    if (typeof Appearance.setColorScheme === 'function') {
      Appearance.setColorScheme(night);
    }
  } catch {
    // Never let theme application crash the process (Expo Go / older RN).
  }
  try {
    if (isVidoraWebAvailable()) {
      getVidoraWeb().setAppNightMode?.(night);
    }
  } catch {
    // An older native build without setAppNightMode: the launch keeps following the device.
  }
}
