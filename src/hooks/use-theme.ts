import { useThemeStore, selectThemeMode } from '@/store/theme';
import { themes, type Theme } from '@/theme';
import { normalizeThemePreference, resolveThemeMode } from '@/theme/theme-preference';

/**
 * Authoritative theme object for the active preference (light | logo | dark).
 */
export function useTheme(): Theme {
  const preference = useThemeStore(selectThemeMode);
  const mode = resolveThemeMode(normalizeThemePreference(preference));
  return themes[mode];
}
