import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as SystemUI from 'expo-system-ui';

import { useTheme } from '@/hooks/use-theme';

/**
 * Status bar + Android root view background sync.
 * Uses Expo APIs only — no custom native Android code.
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

  return <StatusBar style={statusBarStyle} />;
}
