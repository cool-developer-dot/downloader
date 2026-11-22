import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { type PropsWithChildren, useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { isDarkThemeMode, type ThemeMode } from '@/theme';

function createNavigationTheme(mode: ThemeMode, palette: ReturnType<typeof useTheme>['colors']) {
  // Dark and Midnight take the dark navigation base; chrome (header/tab) comes from screen options.
  const base = isDarkThemeMode(mode) ? DarkTheme : DefaultTheme;

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: palette.primary,
      background: palette.background,
      card: palette.headerBackground,
      text: palette.headerText,
      border: palette.border,
      notification: palette.accent,
    },
  };
}

export function NavigationThemeProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  const navigationTheme = useMemo(
    () => createNavigationTheme(theme.mode, theme.colors),
    [theme.mode, theme.colors],
  );

  return <ThemeProvider value={navigationTheme}>{children}</ThemeProvider>;
}
