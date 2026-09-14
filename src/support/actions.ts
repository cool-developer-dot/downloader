import { routePaths } from '@/navigation/constants/route-paths';

import type { SupportAction, SupportActionId } from './types';

export const SUPPORT_ACTIONS: readonly SupportAction[] = [
  {
    id: 'open-browser',
    labelKey: 'support.actions.openBrowser',
    route: routePaths.browser,
  },
  {
    id: 'open-downloads',
    labelKey: 'support.actions.openDownloads',
    route: routePaths.downloads,
  },
  {
    id: 'open-library',
    labelKey: 'support.actions.openLibrary',
    route: routePaths.library,
  },
  {
    id: 'open-download-settings',
    labelKey: 'support.actions.openDownloadSettings',
    route: routePaths.downloadSettings,
  },
  {
    id: 'open-settings',
    labelKey: 'support.actions.openSettings',
    route: routePaths.settings,
  },
  {
    id: 'open-privacy',
    labelKey: 'support.actions.openPrivacy',
    route: routePaths.privacy,
  },
] as const;

const ACTION_BY_ID = Object.fromEntries(
  SUPPORT_ACTIONS.map((action) => [action.id, action]),
) as Record<SupportActionId, SupportAction>;

export function getSupportAction(
  id: SupportActionId | undefined,
): SupportAction | undefined {
  if (!id) {
    return undefined;
  }
  return ACTION_BY_ID[id];
}

export function isValidSupportActionRoute(route: string): boolean {
  return (Object.values(routePaths) as string[]).includes(route);
}
