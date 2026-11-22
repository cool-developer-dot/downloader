import { routeGroups } from './route-groups';

export const rootRouteNames = {
  app: routeGroups.app,
  auth: routeGroups.auth,
} as const;

export const authRouteNames = {
  splash: 'splash',
  onboarding: 'onboarding',
} as const;

export const tabRouteNames = {
  group: routeGroups.tabs,
  home: 'index',
  browser: 'browser',
  downloads: 'downloads',
  library: 'library',
  files: 'files',
  settings: 'settings',
} as const;

export const appStackRouteNames = {
  tabs: routeGroups.tabs,
  about: 'about',
  support: 'support',
  reportProblem: 'report-problem',
  privacy: 'privacy',
  terms: 'terms',
  watchHistory: 'watch-history',
  appLockSetup: 'app-lock-setup',
  appLockDisable: 'app-lock-disable',
  appLockChangePin: 'app-lock-change-pin',
  appLockRotateRecovery: 'app-lock-rotate-recovery',
  storage: 'storage',
  player: 'player/[id]',
  // P7 (Hamza): the user's playlists and one playlist.
  playlists: 'playlists/index',
  playlist: 'playlists/[id]',
} as const;

/** @deprecated Use tabRouteNames or appStackRouteNames */
export const appRouteNames = {
  ...tabRouteNames,
  ...appStackRouteNames,
} as const;

export type RootRouteName = (typeof rootRouteNames)[keyof typeof rootRouteNames];
export type AuthRouteName = (typeof authRouteNames)[keyof typeof authRouteNames];
export type TabRouteName = (typeof tabRouteNames)[keyof typeof tabRouteNames];
export type AppStackRouteName = (typeof appStackRouteNames)[keyof typeof appStackRouteNames];
export type AppRouteName = TabRouteName | AppStackRouteName;
