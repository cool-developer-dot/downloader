import { Stack } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { appStackScreenOptions, createContentStyleOptions } from '@/navigation';

/**
 * The Downloads module's own stack, inside the Downloads tab: the list (index), add download, details, queues and
 * schedule, torrent, statistics, settings, alerts and the rest of the design's download screens. They open over the
 * list with the bottom tab bar still showing. `/downloads/:id` keeps its path (notifications deep-link to it).
 */
/**
 * The module's own page stays under every screen of the stack, also when one is opened by a link (`vidorax://…`, a
 * notification, a widget) from another tab: Back then returns to the list, and the tab never loses it.
 */
export const unstable_settings = { anchor: 'index' };

export default function DownloadsStackLayout() {
  const theme = useTheme();
  const screenOptions = useMemo(
    () => ({ ...appStackScreenOptions, ...createContentStyleOptions(theme.colors.background) }),
    [theme.colors.background],
  );
  return <Stack screenOptions={screenOptions} />;
}
