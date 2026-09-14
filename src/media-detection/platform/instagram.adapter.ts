import type { PlatformPageAdapter } from './types';

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

function isInstagramHost(url: string): boolean {
  const h = host(url);
  return h === 'instagram.com' || h === 'l.instagram.com';
}

function isReelOrPostPath(pathname: string): boolean {
  return (
    /^\/reel\/[^/]+/i.test(pathname) ||
    /^\/p\/[^/]+/i.test(pathname) ||
    /^\/tv\/[^/]+/i.test(pathname)
  );
}

export const instagramPlatformAdapter: PlatformPageAdapter = {
  kind: 'instagram',
  matchesPageUrl: isInstagramHost,
  normalizePageUrl: (url) => {
    try {
      const parsed = new URL(url);
      if (!isInstagramHost(url)) {
        return null;
      }
      parsed.hash = '';
      parsed.search = '';
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
        kind: 'instagram',
        canonicalPageUrl: null,
        isPublicContentPath: false,
        prefersDesktopWebView: false,
      };
    }
    return {
      kind: 'instagram',
      canonicalPageUrl: instagramPlatformAdapter.normalizePageUrl(url),
      isPublicContentPath: isReelOrPostPath(pathname),
      prefersDesktopWebView: false,
    };
  },
};
