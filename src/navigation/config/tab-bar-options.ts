import type { Theme } from '@/theme';

import type { TabScreenOptions } from '../types/navigation';

/**
 * Bottom-tab metadata.
 * Phase 1 visible order: Browser → Downloads → Library → Settings.
 * `home` remains for legacy route-file metadata only (hidden via `href: null`).
 */
export const tabItems = {
  browser: {
    routeName: 'browser',
    title: 'Browser',
    icon: 'web',
    iconFocused: 'web',
    accessibilityLabel: 'Browser tab',
  },
  downloads: {
    routeName: 'downloads',
    title: 'Downloads',
    icon: 'download-outline',
    iconFocused: 'download',
    accessibilityLabel: 'Downloads tab',
  },
  library: {
    routeName: 'library',
    title: 'Library',
    icon: 'book-open-variant',
    iconFocused: 'book-open-variant',
    accessibilityLabel: 'Library tab',
  },
  settings: {
    routeName: 'settings',
    title: 'Settings',
    icon: 'cog-outline',
    iconFocused: 'cog',
    accessibilityLabel: 'Settings tab',
  },
  home: {
    routeName: 'index',
    title: 'Home',
    icon: 'home-outline',
    iconFocused: 'home',
    accessibilityLabel: 'Home tab',
  },
} as const satisfies Record<
  string,
  {
    routeName: string;
    title: string;
    icon: string;
    iconFocused: string;
    accessibilityLabel: string;
  }
>;

export type TabItemKey = keyof typeof tabItems;

/** Visible bottom-nav keys in declaration / product order. */
export const visibleTabItemKeys = [
  'browser',
  'downloads',
  'library',
  'settings',
] as const satisfies readonly TabItemKey[];

export function createTabBarScreenOptions(theme: Theme): TabScreenOptions {
  return {
    headerShown: false,
    tabBarActiveTintColor: theme.colors.bottomNavActive,
    tabBarInactiveTintColor: theme.colors.bottomNavInactive,
  };
}

export function createTabBarStyle(theme: Theme) {
  return {
    backgroundColor: theme.colors.bottomNavBackground,
    borderTopColor: theme.colors.bottomNavBorder,
    borderTopWidth: 1,
  };
}
