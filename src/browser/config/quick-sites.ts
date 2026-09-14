import type { ColorTokenKey } from '@/theme/colors';

export type QuickSiteCategory = 'video' | 'social';

export type QuickSite = {
  id: string;
  name: string;
  url: string;
  hostname: string;
  category: QuickSiteCategory;
  /** MaterialCommunityIcons fallback when favicon fails to load. */
  icon: string;
  /** Subtle tile accent from the VidoraX palette. */
  accent: ColorTokenKey;
};

/**
 * Central quick-access site registry — VidoraX-owned promoted shortcuts.
 * Unsupported video hosts are omitted from promotion (generic browsing still allowed).
 * Icons use domain favicons at render time; `icon` is the offline fallback only.
 */
export const QUICK_SITES: readonly QuickSite[] = [
  {
    id: 'instagram',
    name: 'Instagram',
    url: 'https://www.instagram.com/',
    hostname: 'instagram.com',
    category: 'social',
    icon: 'instagram',
    accent: 'primary',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    url: 'https://www.tiktok.com/',
    hostname: 'tiktok.com',
    category: 'video',
    icon: 'music-note',
    accent: 'textPrimary',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    url: 'https://www.facebook.com/',
    hostname: 'facebook.com',
    category: 'social',
    icon: 'facebook',
    accent: 'info',
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    url: 'https://vimeo.com/',
    hostname: 'vimeo.com',
    category: 'video',
    icon: 'vimeo',
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
    id: 'reddit',
    name: 'Reddit',
    url: 'https://www.reddit.com/',
    hostname: 'reddit.com',
    category: 'social',
    icon: 'reddit',
    accent: 'warning',
  },
  {
    id: 'pinterest',
    name: 'Pinterest',
    url: 'https://www.pinterest.com/',
    hostname: 'pinterest.com',
    category: 'social',
    icon: 'pinterest',
    accent: 'error',
  },
  {
    id: 'telegram',
    name: 'Telegram',
    url: 'https://web.telegram.org/',
    hostname: 'web.telegram.org',
    category: 'social',
    icon: 'send',
    accent: 'info',
  },
  {
    id: 'x',
    name: 'X',
    url: 'https://x.com/',
    hostname: 'x.com',
    category: 'social',
    icon: 'twitter',
    accent: 'textPrimary',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    url: 'https://www.twitch.tv/',
    hostname: 'twitch.tv',
    category: 'video',
    icon: 'twitch',
    accent: 'primary',
  },
  {
    id: 'snapchat',
    name: 'Snapchat',
    url: 'https://web.snapchat.com/',
    hostname: 'web.snapchat.com',
    category: 'social',
    icon: 'ghost',
    accent: 'warning',
  },
] as const;

/**
 * Visible Browser start-page Quick Access — exactly 9 promoted shortcuts (3×3).
 */
export const START_PAGE_QUICK_SITE_IDS = [
  'instagram',
  'tiktok',
  'facebook',
  'vimeo',
  'dailymotion',
  'reddit',
  'pinterest',
  'telegram',
  'x',
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

/** Start-page grid is a fixed 3×3 (9 tiles). */
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
