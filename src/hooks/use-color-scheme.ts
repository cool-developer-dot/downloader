import { useThemeStore, selectThemeMode } from '@/store/theme';
import { normalizeThemePreference } from '@/theme/theme-preference';

export type ResolvedColorScheme = 'light' | 'dark';

/**
 * Binary light/dark scheme for APIs that only understand two modes
 * (StatusBar fallbacks, some RN primitives). Logo resolves as light.
 * Preference is authoritative — OS scheme is NOT used for first-time default.
 */
export function useColorScheme(): ResolvedColorScheme {
  const themeMode = useThemeStore(selectThemeMode);
  const preference = normalizeThemePreference(themeMode);
  return preference === 'dark' ? 'dark' : 'light';
}
