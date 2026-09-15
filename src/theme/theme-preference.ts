/**
 * Theme preference helpers — preference vs resolved palette mode.
 */

import type { ThemeMode } from './colors';

/** User-selectable persisted preference. Default: logo (brand). */
export type ThemePreference = 'light' | 'logo' | 'dark';

/** First-run / missing / malformed preference default. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'logo';

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'light',
  'logo',
  'dark',
] as const;

/**
 * Normalize stored / incoming preference.
 * Legacy `system` → `light` (product requirement);
 * unknown values → `DEFAULT_THEME_PREFERENCE` (first-time / safe default).
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'logo' || value === 'dark') {
    return value;
  }
  // Legacy system preference collapses to LIGHT per product requirement
  // (case-insensitive: 'system' and 'SYSTEM' both occurred in older builds).
  if (typeof value === 'string' && value.toLowerCase() === 'system') {
    return 'light';
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'logo' || value === 'dark';
}

/** Preference always maps 1:1 to a full theme object (no OS takeover). */
export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  return preference;
}
