import { Appearance } from 'react-native';

import type { ThemePreference } from '@/theme/theme-preference';

/**
 * Applies the user's theme preference to React Native's Appearance API.
 *
 * Logo uses the light native scheme (light content + brand chrome).
 * We never follow OS dark as an automatic first-install default.
 */
export function applyNativeColorScheme(mode: ThemePreference): void {
  try {
    if (typeof Appearance.setColorScheme !== 'function') {
      return;
    }

    if (mode === 'dark') {
      Appearance.setColorScheme('dark');
      return;
    }

    // light + logo → light native scheme
    Appearance.setColorScheme('light');
  } catch {
    // Never let theme application crash the process (Expo Go / older RN).
  }
}
