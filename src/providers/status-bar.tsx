import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';

import { useTheme } from '@/hooks/use-theme';

/**
 * Status bar + Android system UI contrast sync.
 * Uses Expo APIs only — no custom native Android code.
 */
export function AppStatusBar() {
  const theme = useTheme();
  const { statusBarStyle, background } = theme.colors;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(background).catch(() => {
      // Non-fatal preference surface.
    });

    if (Platform.OS === 'android') {
      try {
        // light = dark icons on light bar; dark = light icons on dark/red bar
        NavigationBar.setStyle(theme.mode === 'light' ? 'light' : 'dark');
      } catch {
        // Non-fatal.
      }
    }
  }, [background, theme.mode]);

  return <StatusBar style={statusBarStyle} />;
}
