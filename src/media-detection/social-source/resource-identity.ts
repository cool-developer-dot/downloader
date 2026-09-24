/**
 * Stable resource identity vs full executable URL for signed social CDNs.
 */

export function buildResourceIdentityKey(input: {
  contentIdentity: string;
  executableUrl: string;
  transport: string;
  width?: number | null;
  height?: number | null;
  bitrate?: number | null;
  container?: string | null;
}): string {
  const pathKey = stableResourcePath(input.executableUrl) ?? 'unknown';
  const h =
    typeof input.height === 'number' && input.height > 0
      ? String(Math.round(input.height))
      : '';
  const w =
    typeof input.width === 'number' && input.width > 0
      ? String(Math.round(input.width))
      : '';
  const br =
    typeof input.bitrate === 'number' && input.bitrate > 0
      ? String(Math.round(input.bitrate))
      : '';
  const container = (input.container ?? '').toLowerCase();
  return [
    input.contentIdentity,
    input.transport,
    pathKey,
    container,
    w,
    h,
    br,
  ].join('|');
}

/**
 * Signed CDN URLs repeat constantly — the same candidate is re-observed by the
 * DOM scan, the performance observer and the native network stream, and the
 * deduper compares each incoming candidate against every retained one. Parsing
 * is the expensive part (URL + searchParams + sort + re-serialize), so results
 * are memoized by raw URL. Bounded: identity strings are small and the map is
 * cleared whenever detection resets for a new page.
 */
const STABLE_PATH_CACHE_MAX = 512;
const stablePathCache = new Map<string, string | null>();

export function clearStableResourcePathCache(): void {
  stablePathCache.clear();
}

/**
 * Host, case-sensitive path and resource selectors — for internal identity.
 * Hash this value before diagnostics; unknown query fields can contain secrets.
 * NEVER use the result as the download URL.
 */
export function stableResourcePath(url: string): string | null {
  const cached = stablePathCache.get(url);
  if (cached !== undefined) {
    return cached;
  }
  const computed = computeStableResourcePath(url);
  if (stablePathCache.size >= STABLE_PATH_CACHE_MAX) {
    const oldest = stablePathCache.keys().next().value;
    if (oldest !== undefined) {
      stablePathCache.delete(oldest);
    }
  }
  stablePathCache.set(url, computed);
  return computed;
}

function computeStableResourcePath(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    // Preserve content/quality/codec selectors and case-sensitive object paths.
    // Only explicit credential/expiry fields may rotate within an owned resource.
    const selectors = [...parsed.searchParams.entries()]
      .filter(([key]) => !/^(?:token|tok|sig|signature|expires|expire|exp|oe|oh|policy|key-pair-id|x-amz-.+|x-goog-.+|__gda__|hdnea|hdnts)$/i.test(key))
      .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
    const query = new URLSearchParams(selectors).toString();
    return `${host}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

/**
 * Preserve full executable URL (query/signature intact).
 */
export function preserveExecutableUrl(url: string): string {
  return url.trim();
}

export function sameResourceFamily(a: string, b: string): boolean {
  const pa = stableResourcePath(a);
  const pb = stableResourcePath(b);
  return Boolean(pa && pb && pa === pb);
}

export function hashIdentity(value: string): string {
  let hash = 0x811c9dc5;
  const sample = value;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
