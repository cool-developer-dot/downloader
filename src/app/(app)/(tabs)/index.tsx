import { Redirect } from 'expo-router';

import { routePaths } from '@/navigation';

/**
 * Phase 1 — Home is no longer a landing tab.
 * Keep `/` for deep-link / legacy compatibility and redirect to Browser.
 */
export default function HomeToBrowserRedirect() {
  return <Redirect href={routePaths.browser} />;
}
