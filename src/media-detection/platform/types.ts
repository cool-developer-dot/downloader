export type PlatformPageKind = 'generic' | 'instagram' | 'tiktok';

export type PlatformPageInfo = {
  kind: PlatformPageKind;
  canonicalPageUrl: string | null;
  isPublicContentPath: boolean;
  prefersDesktopWebView: boolean;
};

export type PlatformPageAdapter = {
  kind: PlatformPageKind;
  matchesPageUrl: (url: string) => boolean;
  normalizePageUrl: (url: string) => string | null;
  describePage: (url: string) => PlatformPageInfo;
};
