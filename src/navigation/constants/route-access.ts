import { routePaths } from './route-paths';

/** App routes rendered after local initialization. */
export const protectedRoutes = [
  routePaths.home,
  routePaths.browser,
  routePaths.downloads,
  routePaths.library,
  routePaths.settings,
  routePaths.downloadSettings,
  routePaths.appLockSetup,
  routePaths.appLockDisable,
  routePaths.appLockChangePin,
  routePaths.appLockRotateRecovery,
  routePaths.storage,
  routePaths.about,
  routePaths.support,
  routePaths.privacy,
  routePaths.terms,
  routePaths.history,
  routePaths.watchHistory,
  routePaths.bookmarks,
  routePaths.favorites,
] as const;

/** Launch-only routes (branded splash + every-cold-launch cinematic pages). */
export const guestRoutes = [
  routePaths.splash,
  routePaths.onboarding,
] as const;

/** Routes reachable during launch before the app stack. */
export const publicRoutes = [...guestRoutes] as const;

export type ProtectedRoute = (typeof protectedRoutes)[number];
export type GuestRoute = (typeof guestRoutes)[number];
export type PublicRoute = (typeof publicRoutes)[number];

export function isGuestRoute(pathname: string): pathname is GuestRoute {
  return guestRoutes.some((route) => route === pathname);
}

export function isProtectedRoute(pathname: string): pathname is ProtectedRoute {
  if (protectedRoutes.some((route) => route === pathname)) {
    return true;
  }

  return /^\/downloads\/[^/]+$/.test(pathname);
}

export function isKnownRoute(pathname: string): boolean {
  return isGuestRoute(pathname) || isProtectedRoute(pathname);
}
