import {
  ALLOWED_MEDIA_SCHEMES,
  BLOCKED_MEDIA_SCHEMES,
} from '../constants';

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

/** Tracking/query params stripped for same-document matching on social pages. */
const TRACKING_QUERY_PREFIXES = [
  'utm_',
  'igsh',
  'igsi',
  'fbclid',
  'gclid',
  'mc_',
  'ref',
  'share',
  'si',
] as const;

function stripTrackingQueryParams(parsed: URL): void {
  const keys = [...parsed.searchParams.keys()];
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      parsed.searchParams.delete(key);
    }
  }
  if (parsed.searchParams.size === 0) {
    parsed.search = '';
  }
}

/** Same-origin-ish page match — origin + path only (ignore hash + tracking query). */
export function isSameDocumentUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }
  const na = normalizePageIdentity(a);
  const nb = normalizePageIdentity(b);
  return na != null && nb != null && na === nb;
}

export function normalizePageIdentity(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    parsed.hash = '';
    stripTrackingQueryParams(parsed);

    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    return `${parsed.protocol}//${host}${path || '/'}`;
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
