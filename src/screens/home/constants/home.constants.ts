/** Bounded Home rows — never render an unbounded media list. */
export const HOME_SECTION_LIMIT = 5;

/**
 * Week 8.5 Phase 1B freeze: Home is a presentation/aggregation surface.
 * Do not add Home database tables, Home-only history stores, duplicate
 * playback/Library state, polling dashboard APIs, or render-time FS scans.
 */

export const HOME_COPY = {
  brand: 'VidoraX',
  greetingWelcome: 'Welcome to VidoraX',
  pasteLink: 'Paste link',
  pasteLinkA11y: 'Paste a link in Browser to open a video page',
  openBrowser: 'Open Browser',
  openBrowserA11y: 'Open the VidoraX browser',
  openSettingsA11y: 'Open settings',
  activeDownloads: 'Active Downloads',
  noActiveDownloads: 'Nothing downloading right now',
  recentDownloads: 'Recent Downloads',
  noDownloadsYet: 'No downloads yet',
  continueWatching: 'Continue Watching',
  noVideosToContinue: 'Nothing playing right now',
  recentlyWatched: 'Recently Watched',
  watchHistoryEmpty: 'Watch history is empty',
  storage: 'Storage',
  storageUnavailable: 'Storage details unavailable',
  storageUsed: 'Used',
  storageFree: 'Available',
  viewAll: 'View All',
  viewLibraryA11y: 'View all in Library',
  viewDownloadsA11y: 'Open Downloads',
  viewHistoryA11y: 'Open watch history',
  viewStorageA11y: 'Open download settings',
  resumeA11y: 'Opens the video player',
  refreshA11y: 'Refresh Home',
} as const;

export const HOME_DESTINATIONS = {
  browser: '/browser',
  downloads: '/downloads',
  library: '/library',
  settings: '/settings',
  downloadSettings: '/download-settings',
  watchHistory: '/watch-history',
} as const;
