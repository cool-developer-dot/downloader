/**
 * TikTok content identity — video id from /@user/video/{id}.
 * Never uses signed CDN URLs as content identity.
 */

import type {
  SocialContentIdentityResult,
  SocialCorrelationConfidence,
  SocialContentType,
} from './types';

const TIKTOK_HOSTS = new Set([
  'tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
  'm.tiktok.com',
]);

/** TikTok video ids are numeric; bound length against injection noise. */
const VIDEO_ID_RE = /^\d{5,32}$/;

export function isTikTokPageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    return TIKTOK_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function extractTikTokContentIdentity(
  pageUrl: string,
): SocialContentIdentityResult | null {
  if (!isTikTokPageUrl(pageUrl)) {
    return null;
  }

  let pathname = '';
  let canonicalPageUrl: string | null = null;
  try {
    const parsed = new URL(pageUrl);
    pathname = parsed.pathname;
    parsed.hash = '';
    canonicalPageUrl = parsed.toString();
  } catch {
    return {
      platform: 'tiktok',
      contentType: 'unknown_social_video',
      canonicalContentId: null,
      canonicalPageUrl: null,
      identityConfidence: 'WEAK',
    };
  }

  const fromPath = extractTikTokVideoIdFromHref(pathname) ?? extractTikTokVideoIdFromHref(pageUrl);
  if (fromPath) {
    return build('tiktok_video', fromPath, canonicalPageUrl, 'STRONG');
  }

  // Short link path /t/... — no stable video id until resolved.
  if (/^\/t\/[^/]+/i.test(pathname)) {
    return {
      platform: 'tiktok',
      contentType: 'unknown_social_video',
      canonicalContentId: null,
      canonicalPageUrl,
      identityConfidence: 'WEAK',
    };
  }

  // Feed / FYP / following without explicit video id.
  if (isTikTokFeedSurfacePath(pathname)) {
    return {
      platform: 'tiktok',
      contentType: 'tiktok_feed_video',
      canonicalContentId: null,
      canonicalPageUrl,
      identityConfidence: 'WEAK',
    };
  }

  return {
    platform: 'tiktok',
    contentType: 'unknown_social_video',
    canonicalContentId: null,
    canonicalPageUrl,
    identityConfidence: 'WEAK',
  };
}

export function sanitizeTikTokVideoId(
  raw: string | null | undefined,
): string | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!VIDEO_ID_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/**
 * Numeric TikTok item id from an href or path. Never uses signed CDN query.
 */
export function extractTikTokVideoIdFromHref(
  href: string | null | undefined,
): string | null {
  if (!href || typeof href !== 'string') {
    return null;
  }
  const match = /\/video\/(\d{5,32})(?:\/|$|\?|#)/i.exec(href);
  return sanitizeTikTokVideoId(match?.[1] ?? null);
}

/** /foryou, /following, profile root — not a video identity. */
export function isTikTokFeedSurfacePath(pathname: string): boolean {
  const path = pathname.split('?')[0]?.split('#')[0] ?? '';
  return (
    path === '/' ||
    path === '' ||
    /^\/foryou\/?$/i.test(path) ||
    /^\/following\/?$/i.test(path) ||
    /^\/explore\/?$/i.test(path) ||
    /^\/@[^/]+\/?$/i.test(path)
  );
}

export function isBlobMediaUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.trim().toLowerCase().startsWith('blob:');
}

function build(
  contentType: SocialContentType,
  id: string,
  canonicalPageUrl: string | null,
  identityConfidence: SocialCorrelationConfidence,
): SocialContentIdentityResult {
  return {
    platform: 'tiktok',
    contentType,
    canonicalContentId: id,
    canonicalPageUrl,
    identityConfidence,
  };
}

export { VIDEO_ID_RE };
