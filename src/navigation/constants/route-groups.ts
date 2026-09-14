export const routeGroups = {
  app: '(app)',
  auth: '(auth)',
  tabs: '(tabs)',
} as const;

export type RouteGroup = (typeof routeGroups)[keyof typeof routeGroups];
