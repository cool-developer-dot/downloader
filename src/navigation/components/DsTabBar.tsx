import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { memo, useCallback, useMemo } from 'react';
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
  /** Only the navigator's bar is a tour target; a copy drawn elsewhere must not take the targets over. */
  tourTarget: boolean;
  testID: string;
};

const TabButton = memo(function TabButton({ spec, focused, onPress, onLongPress, tourTarget, testID }: TabButtonProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const tourRef = useTourTargetRef(spec.tour ?? 'downloadsTab');
  const color = focused ? theme.colors.bottomNavActive : theme.colors.bottomNavInactive;
  const keys = LABEL_KEYS[spec.label];
  return (
    <View ref={spec.tour && tourTarget ? tourRef : undefined} collapsable={false} style={{ flex: 1 }}>
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

export type DsTabBarViewProps = {
  /** The tab drawn as active (a `tabRouteNames` value). */
  activeRoute: string;
  /** The tabs to draw, in any order (the bar's own order is used); missing ones are left out. */
  routes: readonly string[];
  onPressTab: (route: string, focused: boolean) => void;
  onLongPressTab?: (route: string) => void;
  bottomInset: number;
  /** True for the navigator's bar only (see `TabButton`). */
  tourTargets?: boolean;
};

/**
 * The bar itself, without a navigator: the tab navigator draws it through `DsTabBar`, and the Player page (a screen
 * above the tabs, drawn with the bar as in the design's screen 19) draws it directly.
 */
export const DsTabBarView = memo(function DsTabBarView({
  activeRoute,
  routes,
  onPressTab,
  onLongPressTab,
  bottomInset,
  tourTargets = false,
}: DsTabBarViewProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        backgroundColor: theme.colors.bottomNavBackground,
        borderTopWidth: 1,
        borderTopColor: theme.colors.bottomNavBorder,
        paddingBottom: bottomInset,
        flexDirection: 'row',
        height: ds.size.tabBar + 1 + bottomInset,
      }}>
      {TABS.map((spec) => {
        if (!routes.includes(spec.route)) {
          return null;
        }
        const focused = spec.route === activeRoute;
        return (
          <TabButton
            key={spec.route}
            spec={spec}
            focused={focused}
            onPress={() => onPressTab(spec.route, focused)}
            onLongPress={() => onLongPressTab?.(spec.route)}
            tourTarget={tourTargets}
            testID={`tab-${spec.label}`}
          />
        );
      })}
    </View>
  );
});

/** Every tab of the bar, in order (for a bar drawn outside the navigator). */
export const DS_TAB_ROUTES: readonly string[] = TABS.map((spec) => spec.route);

export const DsTabBar = memo(function DsTabBar({ state, navigation, insets }: BottomTabBarProps) {
  const routeNames = useMemo(() => state.routes.map((route) => route.name), [state.routes]);
  const activeRoute = state.routes[state.index]?.name ?? '';

  const press = useCallback(
    (routeName: string, focused: boolean) => {
      const route = state.routes.find((candidate) => candidate.name === routeName);
      if (!route) {
        return;
      }
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(routeName);
      }
    },
    [navigation, state.routes],
  );

  const longPress = useCallback(
    (routeName: string) => {
      const route = state.routes.find((candidate) => candidate.name === routeName);
      if (route) {
        navigation.emit({ type: 'tabLongPress', target: route.key });
      }
    },
    [navigation, state.routes],
  );

  return (
    <DsTabBarView
      activeRoute={activeRoute}
      routes={routeNames}
      onPressTab={press}
      onLongPressTab={longPress}
      bottomInset={insets.bottom}
      tourTargets
    />
  );
});
