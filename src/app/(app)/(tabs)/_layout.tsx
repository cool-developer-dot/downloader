import { Tabs } from 'expo-router';
import { useMemo } from 'react';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { createTabBarScreenOptions, createTabBarStyle } from '@/navigation/config';
import { tabRouteNames } from '@/navigation/constants';
import { useTabExitBackHandler } from '@/navigation/hooks';
import { PasteLinkRequestHandler } from '@/screens/paste-link/PasteLinkRequestHandler';
import { QualitySelectionProvider } from '@/screens/downloads/quality';
import { renderMiniPlayerTabBar } from '@/screens/player/mini';
import { StreamDownloadHandoff } from '@/player/engine/StreamDownloadHandoff';

/**
 * The five tabs of the design: Browser · Downloads · Player · Files · Settings. The bar itself is `DsTabBar` (drawn
 * by the mini-player dock), which also registers the tour targets. Browser and Downloads are nested stacks, so their
 * own screens (tabs, bookmarks, add download, details…) open inside the tab, with the bar still showing, as in the
 * design.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { t, language } = useTranslation();

  useTabExitBackHandler();

  const screenOptions = useMemo(
    () => ({
      ...createTabBarScreenOptions(theme),
      tabBarStyle: createTabBarStyle(theme),
    }),
    [theme, language],
  );

  return (
    <QualitySelectionProvider>
      {/* The app shortcut / widget "Paste link" runs the Paste link button's own action (H7). */}
      <PasteLinkRequestHandler />
      {/* P14 #672: "Download this stream" from the Player or the Network stream screen. */}
      <StreamDownloadHandoff />
      <Tabs
        initialRouteName={tabRouteNames.browser}
        screenOptions={screenOptions}
        // The mini player docks on top of the tab bar (above the tabs, never over a screen's content).
        tabBar={renderMiniPlayerTabBar}>
        <Tabs.Screen name={tabRouteNames.browser} options={{ title: t('nav.browser') }} />
        <Tabs.Screen name={tabRouteNames.downloads} options={{ title: t('nav.downloads') }} />
        <Tabs.Screen name={tabRouteNames.library} options={{ title: t('nav.library') }} />
        <Tabs.Screen name={tabRouteNames.files} options={{ title: t('nav.files') }} />
        <Tabs.Screen name={tabRouteNames.settings} options={{ title: t('nav.settings') }} />
        {/* Legacy Home route — hidden; index.tsx redirects to Browser. */}
        <Tabs.Screen name={tabRouteNames.home} options={{ href: null }} />
      </Tabs>
    </QualitySelectionProvider>
  );
}
