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
 * Host + pathname only — for fingerprint/dedupe/diagnostics.
 * NEVER use the result as the download URL.
 */
export function stableResourcePath(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }
    return `${host}${parsed.pathname}`.toLowerCase();
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
  const sample =
    value.length > 96 ? `${value.slice(0, 48)}…${value.slice(-24)}` : value;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
