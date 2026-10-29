import {
  SAFE_SEARCH_LEVELS,
  SEARCH_ENGINE_IDS,
  SEARCH_LANGUAGES,
  SEARCH_REGIONS,
} from '@/browser/search/search-engines';
import { ADDRESS_BAR_POSITIONS } from '@/browser/address-bar/address-bar-settings';
import { TAB_SORT_ORDERS } from '@/browser/tabs/tab-list-ops';
import { SCROLL_SPEEDS } from '@/browser/scroll/scroll-speed';
import { PRELOAD_PAGES_CHOICES } from '@/browser/preload/preload-policy';

/**
 * The allowed values of every browser setting that is a choice (stored as a string in `SettingsState`). Settings
 * Backup refuses any other value on import (`src/store/settings/backup.ts`), and each reader normalizes again.
 * Pure — imported by the backup code under Node.
 */
export const BROWSER_SETTING_CHOICES: Readonly<Record<string, readonly string[]>> = {
  tabSortOrder: TAB_SORT_ORDERS,
  searchEngine: SEARCH_ENGINE_IDS,
  safeSearch: SAFE_SEARCH_LEVELS,
  searchLanguage: SEARCH_LANGUAGES,
  searchRegion: SEARCH_REGIONS,
  addressBarPosition: ADDRESS_BAR_POSITIONS,
  scrollSpeed: SCROLL_SPEEDS,
  preloadPages: PRELOAD_PAGES_CHOICES,
};

/** String settings longer than Backup's usual 500-character cap (lists stored as JSON). */
export const BROWSER_SETTING_STRING_LIMITS: Readonly<Record<string, number>> = {
  searchShortcuts: 16_000,
};
