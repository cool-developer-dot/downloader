import type { StoreApi } from 'zustand';

import { setThemeMode } from '@/storage/mmkv';
import { applyNativeColorScheme } from '@/theme/apply-native-color-scheme';
import { normalizeThemePreference, THEME_PREFERENCES } from '@/theme/theme-preference';

import { initialThemeState } from './state';
import type { ThemeActions, ThemePreference, ThemeStore } from './types';

function commitTheme(mode: ThemePreference, set: StoreApi<ThemeStore>['setState']): void {
  const normalized = normalizeThemePreference(mode);
  setThemeMode(normalized);
  applyNativeColorScheme(normalized);
  set({ themeMode: normalized });
}

export function createThemeActions(
  set: StoreApi<ThemeStore>['setState'],
  get: StoreApi<ThemeStore>['getState'],
): ThemeActions {
  return {
    setTheme: (mode) => {
      commitTheme(mode, set);
    },
    toggleTheme: () => {
      const current = normalizeThemePreference(get().themeMode);
      const currentIndex = THEME_PREFERENCES.indexOf(current);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % THEME_PREFERENCES.length;
      commitTheme(THEME_PREFERENCES[nextIndex]!, set);
    },
    reset: () => {
      commitTheme(initialThemeState.themeMode, set);
    },
  };
}
