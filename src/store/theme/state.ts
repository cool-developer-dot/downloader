import { getThemeMode } from '@/storage/mmkv/theme';
import type { ThemePreference } from '@/theme/theme-preference';

/**
 * Seed from MMKV synchronously so the first React frame matches persisted theme.
 * Malformed / missing → LIGHT. Persist middleware rehydrate keeps the same value.
 */
export const initialThemeState: { themeMode: ThemePreference } = {
  themeMode: getThemeMode('light'),
};
