import type { PlatformPageAdapter } from './types';

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isTikTokHost(url: string): boolean {
  const h = host(url);
  return (
    h === 'tiktok.com' ||
    h === 'vt.tiktok.com' ||
    h === 'vm.tiktok.com' ||
    h === 'm.tiktok.com'
  );
}

function isVideoPath(pathname: string): boolean {
  return /\/@[^/]+\/video\/\d+/i.test(pathname) || /^\/t\/[^/]+/i.test(pathname);
}

export const tiktokPlatformAdapter: PlatformPageAdapter = {
  kind: 'tiktok',
  matchesPageUrl: isTikTokHost,
  normalizePageUrl: (url) => {
    try {
      const parsed = new URL(url);
      if (!isTikTokHost(url)) {
        return null;
      }
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  },
  describePage: (url) => {
    let pathname = '';
    try {
      pathname = new URL(url).pathname;
    } catch {
      return {
        kind: 'tiktok',
        canonicalPageUrl: null,
        isPublicContentPath: false,
        prefersDesktopWebView: false,
      };
    }
    return {
      kind: 'tiktok',
      canonicalPageUrl: tiktokPlatformAdapter.normalizePageUrl(url),
      isPublicContentPath: isVideoPath(pathname),
      // Never auto-force Linux desktop UA for TikTok (homepage or video).
      // Platform desktop reload/UA mutation aborted loads into about:blank / ERR_TIMED_OUT.
      // Match Instagram: stay on stock mobile WebView UA; media detection remains passive.
      prefersDesktopWebView: false,
    };
  },
};
