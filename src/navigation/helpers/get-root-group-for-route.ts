import { routeGroups } from '../constants/route-groups';
import { routePaths, type RoutePath } from '../constants/route-paths';

const launchRoutes = new Set<RoutePath>([
  routePaths.splash,
  routePaths.onboarding,
]);

export function getRootGroupForRoute(
  route: RoutePath,
): typeof routeGroups.app | typeof routeGroups.auth {
  return launchRoutes.has(route) ? routeGroups.auth : routeGroups.app;
}
