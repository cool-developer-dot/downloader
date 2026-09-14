import type { ThemePreference } from '@/theme/theme-preference';

export type { ThemePreference };

export interface ThemeState {
  themeMode: ThemePreference;
}

export interface ThemeActions {
  setTheme: (mode: ThemePreference) => void;
  toggleTheme: () => void;
  reset: () => void;
}

export type ThemeStore = ThemeState & ThemeActions;
