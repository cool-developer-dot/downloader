import { mmkvKeys } from '@/storage/constants';
import { mmkvGetBoolean, mmkvSetBoolean } from '@/storage/mmkv';

/**
 * Persists browser-level preferences separate from session continuity.
 */
export const browserPreferencesService = {
  readDesktopMode(): boolean {
    return mmkvGetBoolean(mmkvKeys.browserDesktopMode) ?? false;
  },

  persistDesktopMode(enabled: boolean): void {
    mmkvSetBoolean(mmkvKeys.browserDesktopMode, enabled);
  },

  readDesktopModeUserExplicit(): boolean {
    return mmkvGetBoolean(mmkvKeys.browserDesktopModeUserExplicit) ?? false;
  },

  persistDesktopModeUserExplicit(explicit: boolean): void {
    mmkvSetBoolean(mmkvKeys.browserDesktopModeUserExplicit, explicit);
  },
} as const;
