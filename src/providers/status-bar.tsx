import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState, Platform, StatusBar as NativeStatusBar } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { useTheme } from '@/hooks/use-theme';

/** After a theme change Android may re-apply the window theme (night mode switch, activity config change). */
const REAPPLY_AFTER_MS = [250, 1200] as const;

/**
 * Status bar + Android root view background sync.
 * Uses Expo APIs only — no custom native Android code.
 *
 * The bar's icons follow the theme, not the system: light on Dark, Midnight and the Red theme's band, dark on Light,
 * Cream and Blush. Android can put its own window default back after the declarative style was applied (a night mode
 * switch recreates the window decor; the Red theme is a light night mode with a dark band), so the style is applied
 * again shortly after each theme change and whenever the app comes back to the foreground.
 *
 * Android navigation bar button styling is intentionally not set at runtime.
 * `expo-navigation-bar` only honours a style when the bar uses buttons AND the
 * plugin's `enforceContrast` is `false`; we keep the default `true`, so the OS
 * already guarantees button/content contrast. Calling `NavigationBar.setStyle`
 * anyway was a no-op that additionally threw `MissingActivity` during bundle
 * reload — and because the library discards that promise, it surfaced as an
 * uncatchable unhandled rejection. Configure the `expo-navigation-bar` plugin
 * in app.json if a fixed style is ever needed.
 */
export function AppStatusBar() {
  const theme = useTheme();
  const { statusBarStyle, background } = theme.colors;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(background).catch(() => {
      // Non-fatal preference surface.
    });
  }, [background]);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return undefined;
    }
    const barStyle = statusBarStyle === 'light' ? 'light-content' : 'dark-content';
    const apply = () => {
      try {
        NativeStatusBar.setBarStyle(barStyle, false);
      } catch {
        // No activity (bundle reload): the declarative bar applies it once one exists.
      }
    };
    const timers = REAPPLY_AFTER_MS.map((ms) => setTimeout(apply, ms));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') apply();
    });
    return () => {
      timers.forEach(clearTimeout);
      subscription.remove();
    };
  }, [statusBarStyle]);

  return <StatusBar style={statusBarStyle} />;
}
