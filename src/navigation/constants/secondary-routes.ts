import { routePaths } from './route-paths';

export const secondaryStackRoutes = [
  { label: 'About', path: routePaths.about },
  { label: 'Support', path: routePaths.support },
  { label: 'History', path: routePaths.history },
  { label: 'Bookmarks', path: routePaths.bookmarks },
  { label: 'Favorites', path: routePaths.favorites },
  { label: 'Download Details', path: '/downloads/[id]' as const },
] as const;
