/**
 * Maps v1 download metadata onto `applyLegacyMetadata` entries for the items native `LegacyImport` created.
 * v1 kept titles/platforms/favorites in the expo-sqlite `downloads_catalog` and `url_favorites` tables and
 * file names in the AsyncStorage map `vidorax.downloads.engine.v1`.
 */
import type { SiteId } from '@modules/vidorax-media/src/VidoraMedia.types';

/** Columns read from the v1 `downloads_catalog` table. */
export interface LegacyCatalogRow {
  id: string;
  title: string | null;
  source_url: string | null;
  platform: string | null;
  status: string | null;
  favorite: number | null;
}

export interface LegacyEngineRecord {
  fileName: string | null;
  sourceUrl: string | null;
  complete: boolean;
}

export interface LegacyMetadataEntry {
  id: string;
  title?: string;
  site?: SiteId;
  pageUrl?: string | null;
  favorite?: boolean;
}

export interface LegacyData {
  catalog: readonly LegacyCatalogRow[];
  engine: ReadonlyMap<string, LegacyEngineRecord>;
  favoriteSourceUrls: readonly string[];
}

export function hasLegacyData(data: LegacyData): boolean {
  return data.catalog.length > 0 || data.engine.size > 0 || data.favoriteSourceUrls.length > 0;
}

/** Parses the v1 AsyncStorage download map; malformed input yields no records. */
export function parseLegacyEngineMap(raw: string | null): Map<string, LegacyEngineRecord> {
  const records = new Map<string, LegacyEngineRecord>();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return records;
  }
  if (!isRecord(parsed)) {
    return records;
  }
  for (const [id, value] of Object.entries(parsed)) {
    if (id && isRecord(value)) {
      records.set(id, {
        fileName: stringOrNull(value.fileName),
        sourceUrl: stringOrNull(value.sourceUrl),
        complete: value.localState === 'complete',
      });
    }
  }
  return records;
}

/** Only completed v1 downloads have files for native to import; the rest cannot be resumed by v2. */
export function buildLegacyMetadata(data: LegacyData): LegacyMetadataEntry[] {
  const favoriteKeys = new Set(data.favoriteSourceUrls.map(urlKey).filter((key) => key !== null));
  const catalogById = new Map(data.catalog.map((row) => [row.id, row]));
  const completedIds = new Set<string>();
  for (const row of data.catalog) {
    if (row.status === 'COMPLETED') {
      completedIds.add(row.id);
    }
  }
  for (const [id, record] of data.engine) {
    if (record.complete) {
      completedIds.add(id);
    }
  }

  return [...completedIds].map((id) => {
    const row = catalogById.get(id);
    const record = data.engine.get(id);
    const sourceUrl = row?.source_url || record?.sourceUrl || null;
    const entry: LegacyMetadataEntry = { id };

    const title = row?.title?.trim() || record?.fileName?.replace(/\.[^.]+$/, '').trim();
    if (title) {
      entry.title = title;
    }
    const site = legacySite(row?.platform ?? null, sourceUrl);
    if (site) {
      entry.site = site;
    }
    const pageUrl = legacyPageUrl(sourceUrl);
    if (pageUrl) {
      entry.pageUrl = pageUrl;
    }
    const sourceKey = urlKey(sourceUrl);
    if (row?.favorite === 1 || (sourceKey !== null && favoriteKeys.has(sourceKey))) {
      entry.favorite = true;
    }
    return entry;
  });
}

const PLATFORM_SITES = new Map<string, SiteId>([
  ['instagram', 'instagram'],
  ['facebook', 'facebook'],
  ['tiktok', 'tiktok'],
  ['twitter', 'twitter'],
  ['x', 'twitter'],
  ['reddit', 'reddit'],
  ['vimeo', 'vimeo'],
  ['dailymotion', 'dailymotion'],
  ['twitch', 'twitch'],
  ['pinterest', 'pinterest'],
  ['snapchat', 'snapchat'],
  ['linkedin', 'linkedin'],
]);

const HOST_SITES: readonly (readonly [domain: string, site: SiteId])[] = [
  ['instagram.com', 'instagram'],
  ['cdninstagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['fb.watch', 'facebook'],
  ['fbcdn.net', 'facebook'],
  ['tiktok.com', 'tiktok'],
  ['tiktokcdn.com', 'tiktok'],
  ['tiktokcdn-us.com', 'tiktok'],
  ['tiktokv.com', 'tiktok'],
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['twimg.com', 'twitter'],
  ['reddit.com', 'reddit'],
  ['redd.it', 'reddit'],
  ['vimeo.com', 'vimeo'],
  ['vimeocdn.com', 'vimeo'],
  ['dailymotion.com', 'dailymotion'],
  ['dai.ly', 'dailymotion'],
  ['dmcdn.net', 'dailymotion'],
  ['twitch.tv', 'twitch'],
  ['ttvnw.net', 'twitch'],
  ['pinterest.com', 'pinterest'],
  ['pin.it', 'pinterest'],
  ['pinimg.com', 'pinterest'],
  ['snapchat.com', 'snapchat'],
  ['sc-cdn.net', 'snapchat'],
  ['linkedin.com', 'linkedin'],
  ['licdn.com', 'linkedin'],
];

/** Hosts that serve media files rather than pages a user can reopen. */
const MEDIA_HOSTS = [
  'cdninstagram.com',
  'fbcdn.net',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'twimg.com',
  'v.redd.it',
  'vimeocdn.com',
  'dmcdn.net',
  'ttvnw.net',
  'pinimg.com',
  'sc-cdn.net',
  'licdn.com',
  'googlevideo.com',
  'akamaized.net',
  'cloudfront.net',
];

const MEDIA_PATH = /\.(mp4|m4v|mov|webm|mkv|3gp|flv|ts|m4s|m3u8|mpd|m4a|mp3|aac)$/i;

export function legacySite(platform: string | null, sourceUrl: string | null): SiteId | undefined {
  const fromPlatform = platform ? PLATFORM_SITES.get(platform.trim().toLowerCase()) : undefined;
  if (fromPlatform) {
    return fromPlatform;
  }
  const url = parseHttpUrl(sourceUrl);
  if (!url) {
    return undefined;
  }
  return HOST_SITES.find(([domain]) => hostMatches(url.hostname, domain))?.[1] ?? 'web';
}

/** v1 stored either a page or a direct media URL; only a page is worth keeping as "Open source page". */
export function legacyPageUrl(sourceUrl: string | null): string | undefined {
  const url = parseHttpUrl(sourceUrl);
  if (!url || MEDIA_HOSTS.some((domain) => hostMatches(url.hostname, domain)) || MEDIA_PATH.test(url.pathname)) {
    return undefined;
  }
  return url.toString();
}

/** Comparable form of a URL: as v1 normalized favorites (no fragment, no trailing slash). */
function urlKey(value: string | null): string | null {
  const url = parseHttpUrl(value);
  if (!url) {
    return value?.trim() || null;
  }
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function parseHttpUrl(value: string | null): URL | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
