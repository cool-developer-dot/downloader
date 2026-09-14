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
  settings: 'settings',
} as const;

export const appStackRouteNames = {
  tabs: routeGroups.tabs,
  about: 'about',
  support: 'support',
  reportProblem: 'report-problem',
  privacy: 'privacy',
  terms: 'terms',
  history: 'history',
  watchHistory: 'watch-history',
  bookmarks: 'bookmarks',
  favorites: 'favorites',
  downloadDetails: 'downloads/[id]',
  downloadSettings: 'download-settings',
  appLockSetup: 'app-lock-setup',
  appLockDisable: 'app-lock-disable',
  appLockChangePin: 'app-lock-change-pin',
  appLockRotateRecovery: 'app-lock-rotate-recovery',
  storage: 'storage',
  player: 'player/[id]',
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
