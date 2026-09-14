import { routePaths } from '../../constants/route-paths';

export const favoritesRoutes = {
  index: routePaths.favorites,
} as const;

export type FavoritesRoute = (typeof favoritesRoutes)[keyof typeof favoritesRoutes];
