/**
 * Platform-neutral social content identity resolution.
 */

import { extractInstagramContentIdentity, isInstagramPageUrl } from './instagram-content-identity';
import { extractTikTokContentIdentity, isTikTokPageUrl } from './tiktok-content-identity';
import type { SocialContentIdentityResult, SocialPlatform } from './types';

export function resolveSocialPlatform(pageUrl: string): SocialPlatform | null {
  if (isInstagramPageUrl(pageUrl)) {
    return 'instagram';
  }
  if (isTikTokPageUrl(pageUrl)) {
    return 'tiktok';
  }
  return null;
}

export function extractSocialContentIdentity(
  pageUrl: string,
): SocialContentIdentityResult | null {
  if (isInstagramPageUrl(pageUrl)) {
    return extractInstagramContentIdentity(pageUrl);
  }
  if (isTikTokPageUrl(pageUrl)) {
    return extractTikTokContentIdentity(pageUrl);
  }
  return null;
}

/**
 * Stable content identity key for correlation (never a full signed CDN URL).
 */
export function resolveContentIdentityKey(
  identity: SocialContentIdentityResult,
  ephemeralContentId?: string | null,
): string | null {
  if (identity.canonicalContentId) {
    return `${identity.platform}:${identity.contentType}:${identity.canonicalContentId}`;
  }
  if (ephemeralContentId) {
    return `${identity.platform}:${identity.contentType}:ephemeral:${ephemeralContentId}`;
  }
  return null;
}

/**
 * Same social content across signed CDN refreshes — identity is content id, not resource URL.
 */
export function isSameSocialContent(
  a: SocialContentIdentityResult | null,
  b: SocialContentIdentityResult | null,
): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.platform !== b.platform) {
    return false;
  }
  if (a.canonicalContentId && b.canonicalContentId) {
    return a.canonicalContentId === b.canonicalContentId;
  }
  return false;
}
