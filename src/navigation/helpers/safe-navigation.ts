import { router, type Href } from 'expo-router';

import type { RoutePath } from '../constants/route-paths';

import { resolveFallbackRoute } from './resolve-fallback-route';

export type NavigationTarget = RoutePath | Href;

function toHref(target: NavigationTarget): Href {
  return target as Href;
}

function logNavigationWarning(action: string, target: NavigationTarget | string, error: unknown): void {
  if (__DEV__) {
    console.warn(`[navigation] ${action} failed for`, target, error);
  }
}

export function safeNavigate(target: NavigationTarget): boolean {
  try {
    router.navigate(toHref(target));
    return true;
  } catch (error) {
    logNavigationWarning('navigate', target, error);
    return safeReplace(resolveFallbackRoute());
  }
}

export function safePush(target: NavigationTarget): boolean {
  try {
    router.push(toHref(target));
    return true;
  } catch (error) {
    logNavigationWarning('push', target, error);
    return safeReplace(resolveFallbackRoute());
  }
}

export function safeReplace(target: NavigationTarget): boolean {
  try {
    router.replace(toHref(target));
    return true;
  } catch (error) {
    logNavigationWarning('replace', target, error);

    try {
      router.replace(toHref(resolveFallbackRoute()));
      return true;
    } catch (fallbackError) {
      logNavigationWarning('fallback replace', resolveFallbackRoute(), fallbackError);
      return false;
    }
  }
}

export function safeBack(): boolean {
  try {
    if (router.canGoBack()) {
      router.back();
      return true;
    }

    return false;
  } catch (error) {
    logNavigationWarning('back', 'previous', error);
    return false;
  }
}

export function safeDismissAll(): void {
  try {
    if (typeof router.canDismiss === 'function' && router.canDismiss()) {
      router.dismissAll();
    }
  } catch (error) {
    logNavigationWarning('dismissAll', 'all', error);
  }
}
