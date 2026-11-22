/**
 * Every path the app navigates to. The Browser and Downloads modules are nested stacks inside their tabs (the
 * design keeps the bottom bar on every one of their screens), so their screens live under `/browser/…` and
 * `/downloads/…`. `/downloads/:id` and `/downloads` are unchanged: notifications deep-link to them.
 */
export const routePaths = {
  /**
   * Legacy Home path (`/`). Phase 1 redirects this to Browser.
   * Prefer `routePaths.browser` for new navigation.
   */
  home: '/',
  splash: '/splash',
  onboarding: '/onboarding',
  /** Default landing tab after splash / onboarding / App Lock. */
  browser: '/browser',
  downloads: '/downloads',
  downloadQueue: '/downloads/queue',
  player: '/player',
  library: '/library',
  files: '/files',
  settings: '/settings',
  /** The "Paste link" app shortcut (`vidorax://paste-link`). */
  pasteLink: '/paste-link',

  // ── Browser module (design screens 2–9, 34–39) ────────────────────────────────────────────────────────────────
  /** Design 2: the tabs screen (groups, incognito, sleeping, group history). */
  browserTabs: '/browser/tabs',
  /** Design 3: the page tools of the page in front. */
  browserPageTools: '/browser/page-tools',
  /** Design 4 (B9 bookmark manager). */
  bookmarks: '/browser/bookmarks',
  /** Design 36: browsing history. */
  history: '/browser/history',
  /** Design 5: privacy & security. */
  browserPrivacy: '/browser/privacy',
  /** Design 6: incognito. */
  browserIncognito: '/browser/incognito',
  /** Design 7: passwords & autofill. */
  browserPasswords: '/browser/passwords',
  /** Design 8: developer tools. */
  browserDeveloper: '/browser/developer',
  /** Design 9: browser settings. */
  browserSettings: '/browser/settings',
  /** Design 34: search. */
  browserSearch: '/browser/search',
  /** Design 35: a tab's options (`?tabId=`). */
  browserTabOptions: '/browser/tab-options',
  /** Design 37: focus & site blocker. */
  browserFocus: '/browser/focus',
  /** Design 38: utilities. */
  browserUtilities: '/browser/utilities',
  /** Design 39: display & Urdu. */
  browserDisplay: '/browser/display',
  /** B22 #252: the user's notes (per browser profile). */
  notes: '/browser/notes',
  /** B23 #261: every highlight (per browser profile). */
  highlights: '/browser/highlights',
  /** B17 #178: pages saved for reading offline (per browser profile). */
  savedPages: '/browser/saved-pages',

  // ── Downloads module (design screens 10–17, 33, 40–47) ─────────────────────────────────────────────────────────
  /** Design 11: add download (link, batch, torrent / magnet, playlist). */
  downloadsAdd: '/downloads/add',
  /** Batch Add (#292): several links at once, also opened by the Page Link Grabber (#484). */
  batchAdd: '/downloads/batch-add',
  /** Design 13: queues & schedule. */
  downloadsQueues: '/downloads/queues',
  /** Design 14: torrent. */
  downloadsTorrent: '/downloads/torrent',
  /** Design 15: statistics. */
  downloadsStatistics: '/downloads/statistics',
  /** Design 16: download settings. */
  downloadSettings: '/downloads/settings',
  /** Design 17: alerts & sync. */
  downloadsAlerts: '/downloads/alerts',
  /** Design 40: playlist download. */
  downloadsPlaylist: '/downloads/playlist',
  /** Design 41: live & convert. */
  downloadsLiveConvert: '/downloads/live-convert',
  /** Design 42: auto organize. */
  downloadsOrganize: '/downloads/organize',
  /** Design 43: link grabber. */
  downloadsLinkGrabber: '/downloads/link-grabber',
  /** Design 44: network & remote. */
  downloadsNetwork: '/downloads/network',
  /** Design 45: file actions (`?id=`). */
  downloadsFileActions: '/downloads/file-actions',
  /** Design 46: failed · retry. */
  downloadsFailed: '/downloads/failed',
  /** Design 47: notifications & widgets. */
  downloadsNotifications: '/downloads/notifications',
  /** Download history (H13). */
  downloadHistory: '/downloads/history',
  favorites: '/downloads/favorites',

  // ── App-level stack (outside the tabs) ─────────────────────────────────────────────────────────────────────────
  appLockSetup: '/app-lock-setup',
  appLockDisable: '/app-lock-disable',
  appLockChangePin: '/app-lock-change-pin',
  appLockRotateRecovery: '/app-lock-rotate-recovery',
  storage: '/storage',
  private: '/private',
  dataUsage: '/data-usage',
  support: '/support',
  reportProblem: '/report-problem',
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
  /** Playback / watch history (distinct from browser history). */
  watchHistory: '/watch-history',
  /** B17 #264: the in-app PDF viewer (?path=<cache file>&title=). */
  pdfViewer: '/pdf-viewer',
  /** Videos already on the device, played in VidoraX. */
  deviceVideos: '/device-videos',
  /** P7 #617 / #618: the user's playlists of local videos (Playlist Download is `downloadsPlaylist`). */
  playlists: '/playlists',
} as const;

export type RoutePath = (typeof routePaths)[keyof typeof routePaths];

/** Downloads-stack path for a single download details screen. */
export function downloadDetailsPath(id: string): `/downloads/${string}` {
  return `/downloads/${encodeURIComponent(id)}`;
}

/** App-stack route for internal Player handoff. */
export type PlayerRoute = `/player/${string}`;

/** App-stack path for internal Player handoff. */
export function playerPath(id: string): PlayerRoute {
  return `/player/${encodeURIComponent(id)}`;
}

/** P7 #618: app-stack path of one playlist. */
export function playlistPath(id: string): `/playlists/${string}` {
  return `/playlists/${encodeURIComponent(id)}`;
}
