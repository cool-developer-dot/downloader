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
  settings: '/settings',
  downloadSettings: '/download-settings',
  appLockSetup: '/app-lock-setup',
  appLockDisable: '/app-lock-disable',
  appLockChangePin: '/app-lock-change-pin',
  appLockRotateRecovery: '/app-lock-rotate-recovery',
  storage: '/storage',
  support: '/support',
  reportProblem: '/report-problem',
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
  history: '/history',
  /** Playback / watch history (distinct from browser history). */
  watchHistory: '/watch-history',
  bookmarks: '/bookmarks',
  favorites: '/favorites',
  /** Videos already on the device, played in VidoraX. */
  deviceVideos: '/device-videos',
} as const;

export type RoutePath = (typeof routePaths)[keyof typeof routePaths];

/** App-stack path for a single download details screen. */
export function downloadDetailsPath(id: string): `/downloads/${string}` {
  return `/downloads/${encodeURIComponent(id)}`;
}

/** App-stack route for internal Player handoff. */
export type PlayerRoute = `/player/${string}`;

/** App-stack path for internal Player handoff. */
export function playerPath(id: string): PlayerRoute {
  return `/player/${encodeURIComponent(id)}`;
}
