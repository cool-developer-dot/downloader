import {
  ALLOWED_MEDIA_SCHEMES,
  BLOCKED_MEDIA_SCHEMES,
} from '../constants';
import { resolveSocialPlatform } from '../social/social-content-identity';

/**
 * Validates whether a URL is safe to treat as a media resource.
 * Rejects javascript/blob/file/data, unknown protocols, and private/loopback hosts.
 */
export function isSafeMediaUrl(raw: string | null | undefined): boolean {
  if (!raw || typeof raw !== 'string') {
    return false;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 8_192) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (
    (BLOCKED_MEDIA_SCHEMES as readonly string[]).some((scheme) =>
      lower.startsWith(scheme),
    )
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (!(ALLOWED_MEDIA_SCHEMES as readonly string[]).includes(protocol)) {
      return false;
    }
    if (!parsed.hostname) {
      return false;
    }
    if (isPrivateOrLocalHostname(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Block loopback / link-local / RFC1918 hosts for manifest fetches (SSRF guard).
 * Also blocks IPv4-mapped IPv6 (::ffff:127.0.0.1) used to bypass dotted-quad checks.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');

  const metadataHosts = new Set([
    'metadata.google.internal',
    'metadata.goog',
    'metadata',
    'instance-data',
    'kubernetes.default',
    'kubernetes.default.svc',
  ]);
  if (metadataHosts.has(host) || host.endsWith('.internal')) {
    return true;
  }

  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '::' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local')
  ) {
    return true;
  }

  // Unwrap IPv4-mapped IPv6 before dotted-quad checks.
  let ipv4Host = host;
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(
    host,
  );
  if (mappedDotted?.[1]) {
    ipv4Host = mappedDotted[1];
  } else {
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1]!, 16);
      const lo = Number.parseInt(mappedHex[2]!, 16);
      ipv4Host = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    }
  }

  // IPv4
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ipv4Host);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    const c = Number(ipv4[3]);
    const d = Number(ipv4[4]);
    if ([a, b, c, d].some((n) => n > 255)) {
      return true;
    }
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }

  // IPv6 unique-local / link-local heuristics
  if (
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80') ||
    host.startsWith('fec0')
  ) {
    return true;
  }

  return false;
}

/**
 * Query parameters that never choose what a page shows: ad-click and analytics identifiers, share attribution and
 * player state (a start time, autoplay). Every other parameter can select content — `watch.php?id=2`, `?v=…`,
 * `?episode=3` — so it belongs to the page's identity.
 */
const NOISE_QUERY_KEYS: ReadonlySet<string> = new Set([
  // ad-click / analytics identifiers
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'mkt_tok', '_hsenc', '_hsmi', 'cmpid', 'ncid', 'ocid', 'spm',
  // share attribution
  'igsh', 'igshid', 'igsi', 'mibextid', 'rdid', 'si', 'feature', 'ref', 'ref_src', 'ref_url', 'referrer', 'share',
  'shared', 'share_id', 'share_source', 'share_app_id', 'sharer', 'sr_share', 'is_from_webapp', 'sender_device',
  '_r', '_t',
  // player state
  't', 'start', 'time_continue', 'autoplay', 'muted', 'mute', 'loop', 'playsinline',
]);
const NOISE_QUERY_PREFIXES = ['utm_', 'mc_', '_ga', '_gl', 'mtm_', 'pk_', 'hsa_', 'oly_', 'vero_', '__cft__', '__tn__'];

export function isNoiseQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return NOISE_QUERY_KEYS.has(lower) || NOISE_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** The query parameters that can select page content, in a stable order — '' when there are none. */
export function meaningfulQuery(parsed: URL): string {
  const entries = [...parsed.searchParams.entries()]
    .filter(([key]) => !isNoiseQueryKey(key))
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  return entries.length > 0 ? new URLSearchParams(entries).toString() : '';
}

/**
 * Whether two URLs show the same page: same host (`www.` ignored), path (trailing slash ignored) and content-selecting
 * query. A hash, tracking or share parameters and player state do not make another page; `?id=2` instead of `?id=1`
 * does.
 */
export function isSameDocumentUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const na = normalizePageIdentity(a);
  const nb = normalizePageIdentity(b);
  return na != null && nb != null && na === nb;
}

const PAGE_IDENTITY_CACHE_MAX = 256;
const pageIdentityCache = new Map<string, string | null>();

export function normalizePageIdentity(raw: string): string | null {
  const cached = pageIdentityCache.get(raw);
  if (cached !== undefined) {
    return cached;
  }
  const computed = computePageIdentity(raw);
  if (pageIdentityCache.size >= PAGE_IDENTITY_CACHE_MAX) {
    const oldest = pageIdentityCache.keys().next().value;
    if (oldest !== undefined) {
      pageIdentityCache.delete(oldest);
    }
  }
  pageIdentityCache.set(raw, computed);
  return computed;
}

function computePageIdentity(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    // Social platforms name the content in the path (a reel, a video id) and decorate their URLs with share and
    // session parameters, so only the path identifies one of their pages. Anywhere else the query can pick the video.
    const query = resolveSocialPlatform(parsed.href) ? '' : meaningfulQuery(parsed);
    return `${parsed.protocol}//${host}${path || '/'}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

/** Normalize URL for dedup keys — strip hash, keep query (often carries quality). */
export function normalizeMediaUrl(raw: string): string | null {
  if (!isSafeMediaUrl(raw)) {
    return null;
  }

  try {
    const parsed = new URL(raw.trim());
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Derive a stable platform hint from hostname for future Download Manager.
 * Never invents marketing names — returns hostname slug or null.
 */
export function derivePlatformHint(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) {
    return null;
  }

  const host = extractHostname(pageUrl);
  if (!host) {
    return null;
  }

  const bare = host.replace(/^www\./, '');
  const slug = bare
    .split('.')
    .slice(0, -1)
    .join('_')
    .replace(/[^a-z0-9_]/gi, '')
    .toUpperCase();

  if (!slug || !/^[A-Z][A-Z0-9_]{0,49}$/.test(slug)) {
    return bare.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50).toUpperCase() || null;
  }

  return slug;
}

export function resolveAbsoluteUrl(
  maybeRelative: string,
  pageUrl: string,
): string | null {
  const trimmed = maybeRelative?.trim();
  if (!trimmed) {
    return null;
  }

  if (isSafeMediaUrl(trimmed)) {
    return normalizeMediaUrl(trimmed);
  }

  try {
    const absolute = new URL(trimmed, pageUrl).toString();
    return normalizeMediaUrl(absolute);
  } catch {
    return null;
  }
}
