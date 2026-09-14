/**
 * Theme preference helpers — preference vs resolved palette mode.
 */

import type { ThemeMode } from './colors';

/** User-selectable persisted preference. Default: light. */
export type ThemePreference = 'light' | 'logo' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  'light',
  'logo',
  'dark',
] as const;

/**
 * Normalize stored / incoming preference.
 * Legacy `system` (and unknown values) → `light` (first-time / safe default).
 */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'logo' || value === 'dark') {
    return value;
  }
  // Legacy system preference collapses to LIGHT per product requirement.
  if (value === 'system') {
    return 'light';
  }
  return 'light';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'logo' || value === 'dark';
}

/** Preference always maps 1:1 to a full theme object (no OS takeover). */
export function resolveThemeMode(preference: ThemePreference): ThemeMode {
  return preference;
}
