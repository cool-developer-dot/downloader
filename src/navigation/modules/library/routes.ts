import { routePaths } from '../../constants/route-paths';

export const libraryRoutes = {
  index: routePaths.library,
} as const;

export type LibraryRoute = (typeof libraryRoutes)[keyof typeof libraryRoutes];
