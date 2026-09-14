/**
 * TikTok CDN / MSE network resource classification.
 * Blob URLs are clues only — never executable download sources.
 */

import { hostOf, isLikelySocialThumbnail, isLikelySocialProfileAsset } from '../platform/cdn-hosts';
import { isBlobMediaUrl } from './tiktok-content-identity';

const TIKTOK_MEDIA_HOST_HINTS = [
  'tiktokcdn',
  'tiktokv.com',
  'muscdn.com',
  'byteoversea.com',
] as const;

const TIKTOK_SITE_HOSTS = new Set([
  'tiktok.com',
  'm.tiktok.com',
  'vt.tiktok.com',
  'vm.tiktok.com',
]);

export type TikTokNetworkCandidateClass =
  | 'PROGRESSIVE_MEDIA'
  | 'IMAGE'
  | 'ANALYTICS'
  | 'SITE_DOCUMENT'
  | 'SEGMENT'
  | 'BLOB'
  | 'OTHER';

function hostname(url: string): string | null {
  return hostOf(url);
}

export function isTikTokCdnHost(url: string): boolean {
  const host = hostname(url);
  if (!host) {
    return false;
  }
  if (host.includes('ibyteimg')) {
    return false;
  }
  return TIKTOK_MEDIA_HOST_HINTS.some((hint) => host.includes(hint));
}

export function isTikTokSiteHost(url: string): boolean {
  const host = hostname(url);
  if (!host) {
    return false;
  }
  const bare = host.replace(/^www\./, '');
  return TIKTOK_SITE_HOSTS.has(bare) || bare.endsWith('.tiktok.com');
}

/**
 * Extensionless TikTok playback objects (MSE Range / tos paths).
 * Not thumbnails, not HTML documents, not blob:.
 */
export function isLikelyTikTokProgressiveMediaUrl(url: string): boolean {
  if (!url || isBlobMediaUrl(url)) {
    return false;
  }
  if (isLikelySocialThumbnail(url) || isLikelySocialProfileAsset(url)) {
    return false;
  }
  let path = '';
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (/\.(?:jpg|jpeg|png|webp|gif|svg|js|css|json|html|m4s|ts)(?:$)/i.test(path)) {
    return false;
  }
  const tosOrVideo =
    path.includes('/tos') ||
    path.includes('/video/') ||
    path.includes('/aweme/') ||
    path.includes('/obj/');
  if (isTikTokCdnHost(url) && tosOrVideo) {
    return true;
  }
  if (isTikTokCdnHost(url) && /\.mp4(?:$)/i.test(path)) {
    return true;
  }
  if (isTikTokSiteHost(url) && tosOrVideo && path.includes('/video/tos')) {
    return true;
  }
  return false;
}

export function classifyTikTokNetworkResource(url: string): TikTokNetworkCandidateClass {
  if (isBlobMediaUrl(url)) {
    return 'BLOB';
  }
  const host = hostname(url) ?? '';
  if (host.includes('ibyteimg') || isLikelySocialThumbnail(url)) {
    return 'IMAGE';
  }
  if (/\.(?:m4s|ts)(?:$|\?)/i.test(url) || /(?:^|\/)(?:seg(?:ment)?s?|chunk)(?:[_./-]|$)/i.test(url)) {
    return 'SEGMENT';
  }
  if (isLikelyTikTokProgressiveMediaUrl(url)) {
    return 'PROGRESSIVE_MEDIA';
  }
  if (isTikTokSiteHost(url) && !url.toLowerCase().includes('/video/tos')) {
    return 'SITE_DOCUMENT';
  }
  return 'OTHER';
}

/**
 * Blob MSE player: later CDN fetches are often the next-item preload.
 *
 * Time delta is SECONDARY evidence only. Current owner association,
 * same generation, and progressive/Range request family outrank a
 * fixed 2.5s threshold so a long-lived current video remains eligible.
 */
export function isLikelyTikTokPreloadRelativeToOwner(input: {
  candidateDetectedAt: number;
  ownerObservedAt: number;
  activeVideoIsBlob: boolean;
  /** Current owner/content identity already associated with this resource. */
  currentOwnerAssociated?: boolean;
  requestFamily?: TikTokNetworkCandidateClass | null;
  sameGeneration?: boolean;
}): boolean {
  if (!input.activeVideoIsBlob) {
    return false;
  }
  if (input.currentOwnerAssociated) {
    return false;
  }
  // Progressive/Range family on the same generation is current-video
  // (including signed URL refresh at 10s/30s/60s), not neighbor preload.
  if (
    input.sameGeneration !== false &&
    input.requestFamily === 'PROGRESSIVE_MEDIA'
  ) {
    return false;
  }
  return input.candidateDetectedAt - input.ownerObservedAt > 2500;
}

export function shouldClearDetectionsOnSocialBump(input: {
  bumpKind: 'none' | 'identity_upgrade' | 'ownership_change';
}): boolean {
  return input.bumpKind === 'ownership_change';
}
