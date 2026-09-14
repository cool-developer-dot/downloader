import type { PlatformPageKind } from '../platform/types';

/** Known CDN / media host patterns — hostname substring match. */
export const PLATFORM_CDN_HOSTS: Record<PlatformPageKind, readonly string[]> = {
  tiktok: [
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'tiktokcdn-eu.com',
    'tiktokv.com',
    'tiktok.com',
    'muscdn.com',
    'byteoversea.com',
    'ibyteimg.com',
    'snssdk.com',
  ],
  instagram: [
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com',
    'scontent',
  ],
  generic: [],
};

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function matchesPlatformCdn(
  mediaUrl: string,
  platform: PlatformPageKind,
): boolean {
  const host = hostOf(mediaUrl);
  if (!host) {
    return false;
  }
  const patterns = PLATFORM_CDN_HOSTS[platform] ?? [];
  return patterns.some((pattern) => host.includes(pattern));
}

export function isLikelySocialThumbnail(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /[?&](width|w|height|h)=(?:[1-9]\d{0,2})(?:&|$)/i.test(lower) ||
    /(?:^|[/_.-])(thumb|thumbnail|preview|poster|cover|sprite)(?:[/_.-]|$)/i.test(
      lower,
    ) ||
    /\/s\d{2,3}x\d{2,3}\//i.test(lower)
  );
}

export function isLikelySocialProfileAsset(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    /profile[_-]?pic/i.test(lower) ||
    /avatar/i.test(lower) ||
    /\/(?:s150x150|s320x320|s640x640)\//i.test(lower)
  );
}
