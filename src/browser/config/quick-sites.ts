import type { ColorTokenKey } from '@/theme/colors';

export type QuickSiteCategory = 'video' | 'social';

export type QuickSite = {
  id: string;
  name: string;
  url: string;
  hostname: string;
  category: QuickSiteCategory;
  /** Generic MaterialCommunityIcons glyph shown on the tile. Never a third-party brand logo. */
  icon: string;
  /** Subtle tile accent from the VidoraX palette. */
  accent: ColorTokenKey;
};

/**
 * Central quick-access site registry — VidoraX-owned promoted shortcuts.
 * Unsupported video hosts are omitted from promotion (generic browsing still allowed).
 * Tiles show a generic glyph (`icon`) and the site name only: no brand logos or favicons (store-review and
 * trademark safety, and no favicon request leaves the device from the start page).
 *
 * Every promoted site must be fully usable while logged out. Play review rejected 1.0.2 because a reviewer opened
 * the Facebook tile, landed on Facebook's own login page and reported VidoraX as needing sign-in details. Sites that
 * open on a login, sign-up or phone-number wall (Facebook, Instagram, Telegram Web, X, Pinterest, Snapchat Web,
 * TikTok) stay reachable by typing or pasting a link, but are never promoted here.
 */
export const QUICK_SITES: readonly QuickSite[] = [
  {
    id: 'vimeo',
    name: 'Vimeo',
    url: 'https://vimeo.com/watch',
    hostname: 'vimeo.com',
    category: 'video',
    icon: 'filmstrip',
    accent: 'info',
  },
  {
    id: 'dailymotion',
    name: 'Dailymotion',
    url: 'https://www.dailymotion.com/',
    hostname: 'dailymotion.com',
    category: 'video',
    icon: 'play-circle-outline',
    accent: 'primary',
  },
  {
    id: 'ted',
    name: 'TED Talks',
    url: 'https://www.ted.com/talks',
    hostname: 'ted.com',
    category: 'video',
    icon: 'microphone-outline',
    accent: 'error',
  },
  {
    id: 'internet-archive',
    name: 'Internet Archive',
    url: 'https://archive.org/details/movies',
    hostname: 'archive.org',
    category: 'video',
    icon: 'archive-outline',
    accent: 'warning',
  },
  {
    id: 'wikimedia-commons',
    name: 'Wikimedia Commons',
    url: 'https://commons.wikimedia.org/wiki/Category:Videos',
    hostname: 'commons.wikimedia.org',
    category: 'video',
    icon: 'earth',
    accent: 'textPrimary',
  },
  {
    id: 'mixkit',
    name: 'Mixkit',
    url: 'https://mixkit.co/free-stock-video/',
    hostname: 'mixkit.co',
    category: 'video',
    icon: 'movie-open-outline',
    accent: 'primary',
  },
] as const;

/**
 * Visible Browser start-page Quick Access — six login-free shortcuts (3×2).
 */
export const START_PAGE_QUICK_SITE_IDS = [
  'vimeo',
  'dailymotion',
  'ted',
  'internet-archive',
  'wikimedia-commons',
  'mixkit',
] as const;

const quickSiteById = new Map(QUICK_SITES.map((site) => [site.id, site]));

export const START_PAGE_QUICK_SITES: readonly QuickSite[] = START_PAGE_QUICK_SITE_IDS.map(
  (id) => {
    const site = quickSiteById.get(id);
    if (!site) {
      throw new Error(`START_PAGE_QUICK_SITE_IDS references unknown site: ${id}`);
    }
    return site;
  },
);

/** Quick Access always uses three columns on phones and tablets. */
export const QUICK_ACCESS_COLUMNS = 3 as const;

/** Start-page grid size (3 columns, so 6 tiles fill two rows). */
export const START_PAGE_QUICK_ACCESS_COUNT = START_PAGE_QUICK_SITE_IDS.length;

/** @deprecated Use QUICK_ACCESS_COLUMNS — kept for bookmark grid compatibility. */
export const QUICK_SITE_COLUMNS = {
  compact: QUICK_ACCESS_COLUMNS,
  phone: QUICK_ACCESS_COLUMNS,
  tablet: QUICK_ACCESS_COLUMNS,
} as const;

export function resolveQuickSiteColumns(_windowWidth?: number): number {
  return QUICK_ACCESS_COLUMNS;
}
