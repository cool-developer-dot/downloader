/**
 * Generic general-site content identity.
 * Stable public page/player ids only — never signed CDN URLs or tokens.
 * Not a site-specific parser table.
 */

import { stableResourcePath } from '../social-source/resource-identity';
import { meaningfulQuery } from '../utils/url';

const PAGE_VIDEO_PATH_RE =
  /(?:^|\/)(?:video|videos|watch|embed|media|clip|clips|shorts|reel|reels|v)\/([A-Za-z0-9_-]{5,32})(?:[/?#]|$)/i;

const QUERY_VIDEO_ID_RE = /[?&#](?:video|v)=([A-Za-z0-9_-]{5,32})(?:[&#]|$)/i;

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * Extract a stable public video id from a page or player URL path/query.
 * Does not treat `/player/{widgetId}` as content identity (player chrome, not video).
 */
export function extractGeneralPageVideoId(
  url: string | null | undefined,
): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(url);
    const pathMatch = PAGE_VIDEO_PATH_RE.exec(parsed.pathname);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const queryVideo = parsed.searchParams.get('video') ?? parsed.searchParams.get('v');
    if (queryVideo && /^[A-Za-z0-9_-]{5,32}$/.test(queryVideo)) {
      return queryVideo;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (
      segments.length === 1 &&
      /^[A-Za-z][A-Za-z0-9_-]{4,31}$/.test(segments[0]) &&
      /\d/.test(segments[0])
    ) {
      return segments[0];
    }
  } catch {
    const pathMatch = PAGE_VIDEO_PATH_RE.exec(url);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
    const queryMatch = QUERY_VIDEO_ID_RE.exec(url);
    if (queryMatch?.[1]) {
      return queryMatch[1];
    }
  }
  return null;
}

const MEDIA_URL_CONTENT_ID_RE =
  /\/(?:video|videos|embed|media|clip|clips|shorts|reel|reels|watch|v|p)\/([A-Za-z0-9_-]{5,32})(?:\.[A-Za-z0-9]{2,5})?(?=[/?#]|$)/i;

/** An id-like token: has a digit, or mixes cases — not a word such as `manifest` or `master`. */
function isIdLike(value: string): boolean {
  return /\d/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value));
}

/**
 * The content id a media or manifest URL names in its own path (`…/manifest/video/x9abc12.m3u8`,
 * `…/videos/8812345/master.mpd`), or null. Only a path segment after a video route word counts, and only an id-like
 * token — a CDN object path, a signature or a plain word is never taken for an item.
 */
export function extractMediaUrlContentId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(url);
    const match = MEDIA_URL_CONTENT_ID_RE.exec(parsed.pathname);
    const id = match?.[1] ?? null;
    return id && isIdLike(id) ? id : null;
  } catch {
    return null;
  }
}

/** The item id a general media identity names (`video:<id>`), or null for element/resource identities. */
export function contentIdOfGeneralIdentity(identity: string | null | undefined): string | null {
  if (!identity || !identity.startsWith('video:')) {
    return null;
  }
  const id = identity.slice('video:'.length);
  return /^[A-Za-z0-9_-]{5,32}$/.test(id) ? id : null;
}

/** Whether two content ids are of one kind (both numeric, or both alphanumeric, of about the same length). */
export function sameContentIdShape(a: string, b: string): boolean {
  const numeric = (v: string) => /^\d+$/.test(v);
  if (numeric(a) !== numeric(b)) {
    return false;
  }
  return Math.abs(a.length - b.length) <= (numeric(a) ? 3 : 2);
}

export function generalPagePathKey(pageUrl: string | null | undefined): string | null {
  if (!pageUrl) {
    return null;
  }
  try {
    const u = new URL(pageUrl);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    // `watch.php?id=2` is another page than `watch.php?id=1`.
    const query = meaningfulQuery(u);
    return `${stripWww(u.hostname)}${path || '/'}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

export function sanitizePlayerSrcPath(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('blob:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('file:')
  ) {
    return null;
  }
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null;
    }
    // The resource, not just its path: `stream.mp4?id=2` is another video than `stream.mp4?id=1`, while a rotated
    // signature or expiry on the same video keeps its identity.
    return (stableResourcePath(trimmed) ?? `${stripWww(u.hostname)}${u.pathname}`).slice(0, 160);
  } catch {
    return null;
  }
}

/**
 * Minimum stable identity for a general current owner.
 * Prefers public video id, then element+resource path, then page path.
 */
export function buildGeneralCurrentMediaIdentity(input: {
  pageUrl: string | null | undefined;
  elementIdentity?: string | null;
  src?: string | null;
  associatedContentId?: string | null;
}): string | null {
  const pageId =
    extractGeneralPageVideoId(input.pageUrl) ??
    (input.associatedContentId && /^[A-Za-z0-9_-]{5,32}$/.test(input.associatedContentId)
      ? input.associatedContentId
      : null);
  if (pageId) {
    return `video:${pageId}`.slice(0, 160);
  }

  const element = input.elementIdentity?.trim() || null;
  const path = sanitizePlayerSrcPath(input.src);
  if (element && path) {
    return `${element}:${path}`.slice(0, 160);
  }
  if (element && input.src?.toLowerCase().startsWith('blob:')) {
    return `${element}:blob`.slice(0, 160);
  }
  if (element) {
    return element.slice(0, 160);
  }
  if (path) {
    return path.slice(0, 160);
  }
  return generalPagePathKey(input.pageUrl);
}
