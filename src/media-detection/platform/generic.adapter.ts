import type { PlatformPageAdapter } from './types';

function isPublicVideoPath(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (
      /(?:^|\/)(?:watch|embed|shorts|clip|clips|video|videos|media|reel|reels|v)\/[A-Za-z0-9_-]{4,}/i.test(
        path,
      )
    ) {
      return true;
    }
    const id = parsed.searchParams.get('v') ?? parsed.searchParams.get('video');
    return Boolean(id && id.length >= 4);
  } catch {
    return false;
  }
}

export const genericPlatformAdapter: PlatformPageAdapter = {
  kind: 'generic',
  matchesPageUrl: () => true,
  normalizePageUrl: (url) => url,
  describePage: (url) => ({
    kind: 'generic',
    canonicalPageUrl: url,
    isPublicContentPath: isPublicVideoPath(url),
    prefersDesktopWebView: false,
  }),
};
