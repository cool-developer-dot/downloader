import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { appStackScreenOptions, createContentStyleOptions } from '@/navigation';

/**
 * The Browser module's own stack, inside the Browser tab: the start page / web view (index) and every browser
 * screen of the design (tabs, page tools, bookmarks, history, privacy, incognito, passwords, developer, settings,
 * search, focus, utilities, display…). They open over the browser with the bottom tab bar still showing.
 */
export default function BrowserStackLayout() {
  const theme = useTheme();
  const screenOptions = useMemo(
    () => ({ ...appStackScreenOptions, ...createContentStyleOptions(theme.colors.background) }),
    [theme.colors.background],
  );
  return <Stack screenOptions={screenOptions} />;
}
