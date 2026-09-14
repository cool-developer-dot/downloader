/**
 * Instagram content identity — route shortcode / post id.
 * Never uses CDN URLs, posters, or host-alone as content identity.
 */

import type {
  SocialContentIdentityResult,
  SocialCorrelationConfidence,
  SocialContentType,
} from './types';

const IG_HOST_RE = /^(?:www\.)?(?:instagram\.com|l\.instagram\.com)$/i;

/** Instagram shortcodes are typically 11 chars base64url-ish; allow bounded length. */
const SHORTCODE_RE = /^[A-Za-z0-9_-]{5,32}$/;

export function isInstagramPageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'instagram.com' || host === 'l.instagram.com';
  } catch {
    return false;
  }
}

export function extractInstagramContentIdentity(
  pageUrl: string,
): SocialContentIdentityResult | null {
  if (!isInstagramPageUrl(pageUrl)) {
    return null;
  }

  let pathname = '';
  let canonicalPageUrl: string | null = null;
  try {
    const parsed = new URL(pageUrl);
    pathname = parsed.pathname;
    parsed.hash = '';
    parsed.search = '';
    canonicalPageUrl = parsed.toString();
  } catch {
    return {
      platform: 'instagram',
      contentType: 'unknown_social_video',
      canonicalContentId: null,
      canonicalPageUrl: null,
      identityConfidence: 'WEAK',
    };
  }

  const reel = matchSegment(pathname, 'reel');
  if (reel) {
    return build('instagram_reel', reel, canonicalPageUrl, 'STRONG');
  }

  // Modern Instagram Reels surface uses /reels/{shortcode}/ (plural).
  // Without this, feed swipes keep canonicalContentId=null and CTA dies after video 1.
  const reelsItem = matchSegment(pathname, 'reels');
  if (reelsItem) {
    return build('instagram_reel', reelsItem, canonicalPageUrl, 'STRONG');
  }

  const post = matchSegment(pathname, 'p');
  if (post) {
    return build('instagram_post', post, canonicalPageUrl, 'STRONG');
  }

  const tv = matchSegment(pathname, 'tv');
  if (tv) {
    return build('instagram_post', tv, canonicalPageUrl, 'STRONG');
  }

  // /reels feed root (no shortcode) / home / explore — no fabricated id from host.
  if (
    /^\/reels\/?$/i.test(pathname) ||
    pathname === '/' ||
    /^\/explore/i.test(pathname)
  ) {
    return {
      platform: 'instagram',
      contentType: 'instagram_feed_video',
      canonicalContentId: null,
      canonicalPageUrl,
      identityConfidence: 'WEAK',
    };
  }

  return {
    platform: 'instagram',
    contentType: 'unknown_social_video',
    canonicalContentId: null,
    canonicalPageUrl,
    identityConfidence: 'WEAK',
  };
}

/**
 * Validate a page/DOM-provided shortcode before trusting it.
 */
export function sanitizeInstagramShortcode(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!SHORTCODE_RE.test(trimmed)) {
    return null;
  }
  // Reject obvious non-ids.
  if (/^(reel|reels|p|tv|explore|stories|direct)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function matchSegment(pathname: string, kind: 'reel' | 'reels' | 'p' | 'tv'): string | null {
  const re = new RegExp(`^/${kind}/([^/]+)/?`, 'i');
  const m = re.exec(pathname);
  if (!m?.[1]) {
    return null;
  }
  return sanitizeInstagramShortcode(decodeURIComponent(m[1]));
}

function build(
  contentType: SocialContentType,
  id: string,
  canonicalPageUrl: string | null,
  identityConfidence: SocialCorrelationConfidence,
): SocialContentIdentityResult {
  return {
    platform: 'instagram',
    contentType,
    canonicalContentId: id,
    canonicalPageUrl,
    identityConfidence,
  };
}

export { IG_HOST_RE, SHORTCODE_RE };
