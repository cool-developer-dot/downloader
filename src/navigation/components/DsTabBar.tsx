import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { DsIcon, DsText, ds, type DsIconName } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useTourTargetRef, type TourTargetId } from '@/tour/tour-targets';

import { tabRouteNames } from '../constants/route-names';

/**
 * The design's bottom bar: Browser · Downloads · Player · Files · Settings. 61 dp tall over the bottom inset, the
 * theme's card colour with a 1 dp divider on top, 20 dp Lucide stroke icons over 11 dp semibold labels; the active
 * tab in the accent, the rest in the secondary grey. The Red theme paints the bar in the accent with white labels and
 * a 52 × 26 translucent white pill behind the active icon. The route order and the hidden legacy `index` route are
 * decided here, not by React Navigation's default bar.
 */
type TabSpec = { route: string; icon: DsIconName; label: 'browser' | 'downloads' | 'library' | 'files' | 'settings'; tour?: TourTargetId };

const TABS: readonly TabSpec[] = [
  { route: tabRouteNames.browser, icon: 'globe', label: 'browser' },
  { route: tabRouteNames.downloads, icon: 'download', label: 'downloads', tour: 'downloadsTab' },
  { route: tabRouteNames.library, icon: 'play', label: 'library', tour: 'playerTab' },
  { route: tabRouteNames.files, icon: 'folder', label: 'files' },
  { route: tabRouteNames.settings, icon: 'settings', label: 'settings', tour: 'settingsTab' },
];

const LABEL_KEYS = {
  browser: { label: 'nav.browser', a11y: 'nav.browserTab' },
  downloads: { label: 'nav.downloads', a11y: 'nav.downloadsTab' },
  library: { label: 'nav.library', a11y: 'nav.libraryTab' },
  files: { label: 'nav.files', a11y: 'nav.filesTab' },
  settings: { label: 'nav.settings', a11y: 'nav.settingsTab' },
} as const;

type TabButtonProps = {
  spec: TabSpec;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
  testID: string;
};

const TabButton = memo(function TabButton({ spec, focused, onPress, onLongPress, testID }: TabButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tourRef = useTourTargetRef(spec.tour ?? 'downloadsTab');
  const color = focused ? theme.colors.bottomNavActive : theme.colors.bottomNavInactive;
  const keys = LABEL_KEYS[spec.label];
  return (
    <View ref={spec.tour ? tourRef : undefined} collapsable={false} style={{ flex: 1 }}>
      <Pressable
        testID={testID}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={t(keys.a11y)}
        android_ripple={{ color: theme.colors.bottomNavPressed, borderless: false }}
        style={{ flex: 1, alignItems: 'center', paddingTop: 11, paddingBottom: 8, gap: 5 }}>
        {focused ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 8,
              width: ds.size.tabPillWidth,
              height: ds.size.tabPillHeight,
              borderRadius: ds.size.tabPillHeight / 2,
              backgroundColor: theme.colors.bottomNavActivePill,
            }}
          />
        ) : null}
        <DsIcon name={spec.icon} size={ds.size.tabIcon} color={color} strokeWidth={ds.stroke.tabBar} />
        <DsText variant="tabLabel" color={color} numberOfLines={1} align="center">
          {t(keys.label)}
        </DsText>
      </Pressable>
    </View>
  );
});

export const DsTabBar = memo(function DsTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const theme = useTheme();

  const press = useCallback(
    (routeName: string, routeKey: string, focused: boolean) => {
      const event = navigation.emit({ type: 'tabPress', target: routeKey, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(routeName);
      }
    },
    [navigation],
  );

  const longPress = useCallback(
    (routeKey: string) => {
      navigation.emit({ type: 'tabLongPress', target: routeKey });
    },
    [navigation],
  );

  return (
    <View
      accessibilityRole="tablist"
      style={{
        backgroundColor: theme.colors.bottomNavBackground,
        borderTopWidth: 1,
        borderTopColor: theme.colors.bottomNavBorder,
        paddingBottom: insets.bottom,
        flexDirection: 'row',
        height: ds.size.tabBar + 1 + insets.bottom,
      }}>
      {TABS.map((spec) => {
        const index = state.routes.findIndex((route) => route.name === spec.route);
        if (index < 0) {
          return null;
        }
        const route = state.routes[index]!;
        const focused = state.index === index;
        return (
          <TabButton
            key={spec.route}
            spec={spec}
            focused={focused}
            onPress={() => press(route.name, route.key, focused)}
            onLongPress={() => longPress(route.key)}
            testID={`tab-${spec.label}`}
          />
        );
      })}
    </View>
  );
});
