import { mmkvKeys } from '@/storage/constants';
import {
  normalizeThemePreference,
  type ThemePreference,
} from '@/theme/theme-preference';

import { getMmkvInstance } from './instance';

export function getThemeMode(defaultValue: ThemePreference = 'light'): ThemePreference {
  try {
    const value = getMmkvInstance()?.getString(mmkvKeys.themeMode);
    if (value == null || value === '') {
      return defaultValue;
    }
    return normalizeThemePreference(value);
  } catch {
    return defaultValue;
  }
}

export function setThemeMode(mode: ThemePreference): void {
  try {
    getMmkvInstance()?.set(mmkvKeys.themeMode, normalizeThemePreference(mode));
  } catch {
    // Preference write failure must not crash the app.
  }
}

export function clearThemeMode(): void {
  try {
    getMmkvInstance()?.remove(mmkvKeys.themeMode);
  } catch {
    // ignore
  }
}
