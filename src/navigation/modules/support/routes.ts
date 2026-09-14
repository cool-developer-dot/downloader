import { routePaths } from '../../constants/route-paths';

export const supportRoutes = {
  index: routePaths.support,
  reportProblem: routePaths.reportProblem,
} as const;

export type SupportRoute = (typeof supportRoutes)[keyof typeof supportRoutes];
