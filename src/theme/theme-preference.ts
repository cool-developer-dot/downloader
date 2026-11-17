/**
 * Theme preference helpers — preference vs resolved palette mode.
 */

import type { ThemeMode } from './colors';

/** User-selectable persisted preference: the six themes of the design, in the PDF's order. */
export type ThemePreference = 'light' | 'dark' | 'red' | 'cream' | 'midnight' | 'blush';

/** First-run / missing / malformed preference default. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'red', 'cream', 'midnight', 'blush'] as const;

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Normalize stored / incoming preference.
 * Legacy `logo` (the old brand-red chrome) → `red`; legacy `system` (any case) → `light`;
 * unknown values → `DEFAULT_THEME_PREFERENCE`.
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (isThemePreference(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'logo') {
      return 'red';
    }
    if (lower === 'system') {
      return 'light';
    }
    if (isThemePreference(lower)) {
      return lower;
    }
  }
  return DEFAULT_THEME_PREFERENCE;
}

/** Preference always maps 1:1 to a full theme object (no OS takeover). */
export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  return preference;
}

/** Dark page and cards: Dark and Midnight. Decides night mode, the dark navigation / Paper bases and force-dark pages. */
export function isDarkThemeMode(mode: ThemeMode): boolean {
  return mode === 'dark' || mode === 'midnight';
}

/** Light/dark as Android's night mode sees it. */
export function nightModeOf(preference: ThemePreference): 'light' | 'dark' {
  return isDarkThemeMode(preference) ? 'dark' : 'light';
}
