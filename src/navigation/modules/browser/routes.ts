import { routePaths } from '../../constants/route-paths';

export const browserRoutes = {
  index: routePaths.browser,
  history: routePaths.history,
  bookmarks: routePaths.bookmarks,
} as const;

export type BrowserRoute = (typeof browserRoutes)[keyof typeof browserRoutes];
