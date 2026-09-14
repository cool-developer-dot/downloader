import { selectAppInitialized, useAppStore } from '@/store/app';

import { routePaths, type RoutePath } from '../constants/route-paths';

import { resolvePostSplashRoute } from './resolve-post-splash-route';

export function resolveFallbackRoute(): RoutePath {
  const appState = useAppStore.getState();

  if (!selectAppInitialized(appState)) {
    return routePaths.splash;
  }

  // Cold-start continuation — never skip cinematic splash via persisted flags.
  return resolvePostSplashRoute();
}
