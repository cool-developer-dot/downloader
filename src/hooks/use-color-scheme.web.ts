import { useThemeStore, selectThemeMode } from '@/store/theme';
import { normalizeThemePreference } from '@/theme/theme-preference';

export type ResolvedColorScheme = 'light' | 'dark';

/** Web: preference-only (no OS dark takeover). */
export function useColorScheme(): ResolvedColorScheme {
  const themeMode = useThemeStore(selectThemeMode);
  const preference = normalizeThemePreference(themeMode);
  return preference === 'dark' ? 'dark' : 'light';
}
