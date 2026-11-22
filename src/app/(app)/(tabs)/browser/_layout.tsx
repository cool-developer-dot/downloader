import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { appStackScreenOptions, createContentStyleOptions } from '@/navigation';

/**
 * The Browser module's own stack, inside the Browser tab: the start page / web view (index) and every browser
 * screen of the design (tabs, page tools, bookmarks, history, privacy, incognito, passwords, developer, settings,
 * search, focus, utilities, display…). They open over the browser with the bottom tab bar still showing.
 */
/**
 * The module's own page stays under every screen of the stack, also when one is opened by a link (`vidorax://…`, a
 * notification, a widget) from another tab: Back then returns to the start page / web view, and the tab never loses it.
 */
export const unstable_settings = { anchor: 'index' };

export default function BrowserStackLayout() {
  const theme = useTheme();
  const screenOptions = useMemo(
    () => ({ ...appStackScreenOptions, ...createContentStyleOptions(theme.colors.background) }),
    [theme.colors.background],
  );
  return <Stack screenOptions={screenOptions} />;
}
