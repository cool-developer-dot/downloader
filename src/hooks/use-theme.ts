import { createContext, useContext } from 'react';

import { useThemeStore, selectThemeMode } from '@/store/theme';
import { themes, type Theme } from '@/theme';
import { normalizeThemePreference, resolveThemeMode } from '@/theme/theme-preference';

/**
 * B21 #245: a part of the screen that must use one palette whatever the app theme (the start page over its own
 * background uses the dark one, so its text stays readable over the dark layer). Unset everywhere else: no change.
 */
export const ThemeModeOverrideContext = createContext<keyof typeof themes | null>(null);

/**
 * Authoritative theme object for the active preference (light | logo | dark).
 */
export function useTheme(): Theme {
  const override = useContext(ThemeModeOverrideContext);
  const preference = useThemeStore(selectThemeMode);
  const mode = override ?? resolveThemeMode(normalizeThemePreference(preference));
  return themes[mode];
}
