import { routePaths } from '../../constants/route-paths';

export const splashRoutes = {
  index: routePaths.splash,
} as const;

export type SplashRoute = (typeof splashRoutes)[keyof typeof splashRoutes];
