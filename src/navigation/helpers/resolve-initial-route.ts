import { routePaths, type RoutePath } from '../constants/route-paths';

/**
 * Cold-start entry is always the branded splash so the launch
 * sequence replays on every app open — never skipped after first launch.
 */
export function resolveInitialRoute(): RoutePath {
  return routePaths.splash;
}
