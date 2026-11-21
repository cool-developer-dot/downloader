import type { DsIconName } from '@/design/DsIcon';
import type { ColorTokenKey } from '@/theme/colors';

export type QuickSiteCategory = 'video' | 'social';

export type QuickSite = {
  id: string;
  name: string;
  url: string;
  hostname: string;
  category: QuickSiteCategory;
  /** Generic MaterialCommunityIcons glyph shown on the tile (legacy Home grid). Never a third-party brand logo. */
  icon: string;
  /** The light design's Lucide glyph for the start page tile (design 1: camera, music, users, film, play, file-text). */
  dsIcon: DsIconName;
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
 * the Facebook tile, landed on Facebook's own login page and reported VidoraX as needing sign-in details (fixed in
 * 1.0.3, `release/1.0` de1cf91 / e212d0a — ported here for 1.2.0). Sites that open on a login, sign-up or
 * phone-number wall (Facebook, Instagram, Telegram Web, X, Pinterest, Snapchat Web, TikTok, and Dailymotion, which
 * shows "Join Dailymotion" to new visitors in the WebView) stay reachable by typing or pasting a link, but are never
 * promoted here. Check a new tile on a fresh emulator install before adding it. The design draws six tiles (design 1,
 * 3 × 2): the four from 1.0.3 plus NASA and ESA, both checked logged out in the app on 2026-11-21 (Coverr was not
 * added: it opens on a full-screen sales pop-up; Pexels, Pixabay and Videezy answer with a Cloudflare challenge).
 */
export const QUICK_SITES: readonly QuickSite[] = [
  {
    id: 'vimeo',
    name: 'Vimeo',
    url: 'https://vimeo.com/watch',
    hostname: 'vimeo.com',
    category: 'video',
    icon: 'filmstrip',
    dsIcon: 'film',
    accent: 'info',
  },
  {
    id: 'ted',
    name: 'TED Talks',
    url: 'https://www.ted.com/talks',
    hostname: 'ted.com',
    category: 'video',
    icon: 'microphone-outline',
    dsIcon: 'mic',
    accent: 'error',
  },
  {
    id: 'wikimedia-commons',
    name: 'Wikimedia',
    url: 'https://commons.wikimedia.org/wiki/Category:Videos',
    hostname: 'commons.wikimedia.org',
    category: 'video',
    icon: 'earth',
    dsIcon: 'globe',
    accent: 'textPrimary',
  },
  {
    id: 'mixkit',
    name: 'Mixkit',
    url: 'https://mixkit.co/free-stock-video/',
    hostname: 'mixkit.co',
    category: 'video',
    icon: 'movie-open-outline',
    dsIcon: 'play',
    accent: 'primary',
  },
  {
    id: 'nasa',
    name: 'NASA',
    url: 'https://images.nasa.gov/search?media=video',
    hostname: 'images.nasa.gov',
    category: 'video',
    icon: 'rocket-launch-outline',
    dsIcon: 'star',
    accent: 'info',
  },
  {
    id: 'esa',
    name: 'ESA',
    url: 'https://www.esa.int/ESA_Multimedia/Videos',
    hostname: 'esa.int',
    category: 'video',
    icon: 'satellite-variant',
    dsIcon: 'tv',
    accent: 'textPrimary',
  },
] as const;

/**
 * Visible Browser start-page Quick Access — login-free shortcuts only, in the design's 3 × 2 grid (design 1).
 */
export const START_PAGE_QUICK_SITE_IDS = ['vimeo', 'ted', 'wikimedia-commons', 'mixkit', 'nasa', 'esa'] as const;

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

/** Start-page Quick Access tile count (laid out in QUICK_ACCESS_COLUMNS columns). */
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
