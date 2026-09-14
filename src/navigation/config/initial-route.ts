import { routeGroups } from '../constants/route-groups';

// Default to auth group so cold starts do not briefly mount protected routes.
export const initialRouteName = routeGroups.auth;

export const rootLayoutSettings = {
  initialRouteName,
} as const;
