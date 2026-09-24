import { selectAppInitialized, useAppStore } from '@/store/app';

import { routePaths, type RoutePath } from '../constants/route-paths';

import { resolvePostSplashRoute } from './resolve-post-splash-route';

export function resolveFallbackRoute(): RoutePath {
  const appState = useAppStore.getState();

  if (!selectAppInitialized(appState)) {
    return routePaths.splash;
  }

  // Cold-start continuation: a returning user goes to Browser, a first launch to the intro.
  return resolvePostSplashRoute({ onboardingComplete: appState.onboardingComplete });
}
