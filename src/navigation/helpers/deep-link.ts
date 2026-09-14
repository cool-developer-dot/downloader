import { linkingPrefixes } from '../config/linking';
import { routePaths, type RoutePath } from '../constants/route-paths';
import { isKnownRoute } from '../constants/route-access';

import { resolveFallbackRoute } from './resolve-fallback-route';

const knownDeepLinkPaths = new Set<string>(Object.values(routePaths));

export function normalizeDeepLinkPath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed) {
    return routePaths.home;
  }

  const withoutQuery = trimmed.split('?')[0]?.split('#')[0] ?? trimmed;
  const normalized = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;

  return normalized.replace(/\/+$/, '') || routePaths.home;
}

export function isValidDeepLinkPath(path: string): boolean {
  return knownDeepLinkPaths.has(normalizeDeepLinkPath(path));
}

export function resolveDeepLinkPath(path: string): RoutePath {
  const normalized = normalizeDeepLinkPath(path);

  if (isKnownRoute(normalized)) {
    return normalized as RoutePath;
  }

  return resolveFallbackRoute();
}

export function getLinkingPrefixes(): readonly string[] {
  return linkingPrefixes;
}
