import { routePaths } from '../../constants/route-paths';

export const onboardingRoutes = {
  index: routePaths.onboarding,
} as const;

export type OnboardingRoute = (typeof onboardingRoutes)[keyof typeof onboardingRoutes];
