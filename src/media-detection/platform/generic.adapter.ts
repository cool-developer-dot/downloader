import type { PlatformPageAdapter } from './types';

export const genericPlatformAdapter: PlatformPageAdapter = {
  kind: 'generic',
  matchesPageUrl: () => true,
  normalizePageUrl: (url) => url,
  describePage: (url) => ({
    kind: 'generic',
    canonicalPageUrl: url,
    isPublicContentPath: false,
    prefersDesktopWebView: false,
  }),
};
