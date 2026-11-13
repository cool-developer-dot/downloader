/**
 * B22 #273 — which app a page belongs to, for "Open in app" (pure). Only these six; VidoraWeb checks the app is
 * installed through the app manifest's `<queries>` package entries.
 */
export const OPEN_IN_APP_IDS = ['youtube', 'instagram', 'facebook', 'tiktok', 'x', 'maps'] as const;
export type OpenInAppId = (typeof OPEN_IN_APP_IDS)[number];

export const OPEN_IN_APP_NAMES: Record<OpenInAppId, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X',
  maps: 'Google Maps',
};

export const MAX_OPEN_IN_APP_NEVER_SITES = 100;
export const DEFAULT_OPEN_IN_APP_NEVER_JSON = '[]';

const covers = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** The app for an https page, or null. */
export function appForUrl(url: string | null | undefined): OpenInAppId | null {
  let parsed: URL;
  try {
    parsed = new URL((url ?? '').trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (covers(host, 'youtube.com') || host === 'youtu.be') return 'youtube';
  if (covers(host, 'instagram.com')) return 'instagram';
  if (covers(host, 'facebook.com') || host === 'fb.watch') return 'facebook';
  if (covers(host, 'tiktok.com')) return 'tiktok';
  if (covers(host, 'x.com') || covers(host, 'twitter.com')) return 'x';
  if (host === 'maps.google.com' || host === 'maps.app.goo.gl') return 'maps';
  if ((host === 'google.com' || host === 'www.google.com') && parsed.pathname.startsWith('/maps')) return 'maps';
  return null;
}

/** The site key the chip and "Don't ask for this site" use: the page's host without `www.`. */
export function openInAppSite(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export function parseNeverSites(raw: unknown): string[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const site = item.trim().toLowerCase().replace(/^www\./, '');
    if (/^[a-z0-9.-]{1,253}$/.test(site) && site.includes('.') && !out.includes(site)) out.push(site);
    if (out.length >= MAX_OPEN_IN_APP_NEVER_SITES) break;
  }
  return out;
}

export function serializeNeverSites(list: readonly string[]): string {
  return JSON.stringify(parseNeverSites([...list]));
}

/**
 * The app to offer for `url`: the setting on, the app installed, the site not on the "Don't ask" list, and not offered
 * for this site yet in this app session. Null otherwise.
 */
export function shouldOfferOpenInApp(input: {
  url: string;
  enabled: boolean;
  neverSites: readonly string[];
  shownThisSession: ReadonlySet<string>;
  isInstalled: (app: OpenInAppId) => boolean;
}): OpenInAppId | null {
  if (!input.enabled) return null;
  const app = appForUrl(input.url);
  const site = openInAppSite(input.url);
  if (!app || !site) return null;
  if (input.neverSites.includes(site) || input.shownThisSession.has(site)) return null;
  return input.isInstalled(app) ? app : null;
}
