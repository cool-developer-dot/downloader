import { routePaths } from '../../constants/route-paths';

export const aboutRoutes = {
  index: routePaths.about,
} as const;

export type AboutRoute = (typeof aboutRoutes)[keyof typeof aboutRoutes];
