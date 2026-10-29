import { TAB_SORT_ORDERS } from '@/browser/tabs/tab-list-ops';

/**
 * The allowed values of every browser setting that is a choice (stored as a string in `SettingsState`). Settings
 * Backup refuses any other value on import (`src/store/settings/backup.ts`), and each reader normalizes again.
 * Pure — imported by the backup code under Node.
 */
export const BROWSER_SETTING_CHOICES: Readonly<Record<string, readonly string[]>> = {
  tabSortOrder: TAB_SORT_ORDERS,
};
