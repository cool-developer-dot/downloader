import { router, type Href } from 'expo-router';

import type { RoutePath } from '../constants/route-paths';

import {
  safeBack,
  safeDismissAll,
  safeNavigate,
  safePush,
  safeReplace,
  type NavigationTarget,
} from './safe-navigation';

export type { NavigationTarget };

export function navigate(target: NavigationTarget) {
  safeNavigate(target);
}

export function push(target: NavigationTarget) {
  safePush(target);
}

export function replace(target: NavigationTarget) {
  safeReplace(target);
}

export function back() {
  safeBack();
}

export function dismiss(count = 1) {
  router.dismiss(count);
}

export function canGoBack() {
  return router.canGoBack();
}

export function resetNavigation(target: RoutePath | Href) {
  safeDismissAll();
  safeReplace(target);
}

export const navigation = {
  navigate,
  push,
  replace,
  back,
  dismiss,
  canGoBack,
  resetNavigation,
} as const;
