import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { type ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { TabBarIcon } from '@/navigation/components';
import { createTabBarScreenOptions, createTabBarStyle, tabItems } from '@/navigation/config';
import { tabRouteNames } from '@/navigation/constants';
import { useTabExitBackHandler } from '@/navigation/hooks';
import { QualitySelectionProvider } from '@/screens/downloads/quality';
import { renderMiniPlayerTabBar } from '@/screens/player/mini';

function createTabIcon(icon: string, iconFocused: string) {
  return function TabIcon({
    color,
    size,
    focused,
  }: {
    color: ColorValue;
    size: number;
    focused: boolean;
  }) {
    return <TabBarIcon name={focused ? iconFocused : icon} color={color} size={size} />;
  };
}

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

  const tabIcons = useMemo(
    () => ({
      browser: createTabIcon(tabItems.browser.icon, tabItems.browser.iconFocused),
      downloads: createTabIcon(tabItems.downloads.icon, tabItems.downloads.iconFocused),
      library: createTabIcon(tabItems.library.icon, tabItems.library.iconFocused),
      settings: createTabIcon(tabItems.settings.icon, tabItems.settings.iconFocused),
    }),
    [],
  );

  return (
    <QualitySelectionProvider>
      <Tabs
        initialRouteName={tabRouteNames.browser}
        screenOptions={screenOptions}
        // The mini player docks on top of the tab bar (above the tabs, never over a screen's content).
        tabBar={renderMiniPlayerTabBar}>
        {/* Visible tabs — Browser first (default landing). */}
        <Tabs.Screen
          name={tabRouteNames.browser}
          options={{
            title: t('nav.browser'),
            tabBarLabel: t('nav.browser'),
            tabBarAccessibilityLabel: t('nav.browserTab'),
            tabBarIcon: tabIcons.browser,
          }}
        />
        <Tabs.Screen
          name={tabRouteNames.downloads}
          options={{
            title: t('nav.downloads'),
            tabBarLabel: t('nav.downloads'),
            tabBarAccessibilityLabel: t('nav.downloadsTab'),
            tabBarIcon: tabIcons.downloads,
          }}
        />
        <Tabs.Screen
          name={tabRouteNames.library}
          options={{
            title: t('nav.library'),
            tabBarLabel: t('nav.library'),
            tabBarAccessibilityLabel: t('nav.libraryTab'),
            tabBarIcon: tabIcons.library,
          }}
        />
        <Tabs.Screen
          name={tabRouteNames.settings}
          options={{
            title: t('nav.settings'),
            tabBarLabel: t('nav.settings'),
            tabBarAccessibilityLabel: t('nav.settingsTab'),
            tabBarIcon: tabIcons.settings,
          }}
        />
        {/* Legacy Home route — hidden; index.tsx redirects to Browser. */}
        <Tabs.Screen
          name={tabRouteNames.home}
          options={{
            href: null,
          }}
        />
      </Tabs>
    </QualitySelectionProvider>
  );
}
