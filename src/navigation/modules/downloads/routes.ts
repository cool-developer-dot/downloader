import { downloadDetailsPath, routePaths } from '../../constants/route-paths';

export const downloadsRoutes = {
  index: routePaths.downloads,
  details: downloadDetailsPath,
} as const;

export type DownloadsRoute =
  | (typeof downloadsRoutes)['index']
  | ReturnType<typeof downloadDetailsPath>;
