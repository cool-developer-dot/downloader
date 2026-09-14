import { routePaths } from '../../constants/route-paths';

export const settingsRoutes = {
  index: routePaths.settings,
  downloadSettings: routePaths.downloadSettings,
} as const;

export type SettingsRoute = (typeof settingsRoutes)[keyof typeof settingsRoutes];
