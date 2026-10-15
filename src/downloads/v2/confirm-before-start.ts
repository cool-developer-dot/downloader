import { useSettingsStore } from '@/store/settings';

/**
 * Confirm Before Start (#479): with the setting on (default off), tapping "Video available" always opens the quality
 * sheet — even for a single quality that would otherwise start at once — so its Options can be set first.
 */
export function isConfirmBeforeStartOn(): boolean {
  try {
    return useSettingsStore.getState().confirmBeforeStart === true;
  } catch {
    return false;
  }
}
