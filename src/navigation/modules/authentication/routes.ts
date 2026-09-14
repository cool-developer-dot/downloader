import { routePaths } from '../../constants/route-paths';

export const authenticationRoutes = {
  splash: routePaths.splash,
  onboarding: routePaths.onboarding,
} as const;

export type AuthenticationRoute =
  (typeof authenticationRoutes)[keyof typeof authenticationRoutes];
