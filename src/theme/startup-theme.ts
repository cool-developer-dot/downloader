/**
 * Synchronous startup theme resolution for first React-owned frames.
 * Reads MMKV (falls back LIGHT) — does not create a second theme store.
 */

import { getThemeMode } from '@/storage/mmkv/theme';
import { colors, type ThemeMode } from './colors';
import { resolveIntroColors } from './intro-palette';
import {
  normalizeThemePreference,
  resolveThemeMode,
  type ThemePreference,
} from './theme-preference';

/** Persisted preference → ThemeMode (malformed / missing → light). */
export function resolvePersistedThemeMode(
  fallback: ThemePreference = 'light',
): ThemeMode {
  return resolveThemeMode(normalizeThemePreference(getThemeMode(fallback)));
}

/** Semantic app background for root / stack chrome before paint. */
export function resolveStartupBackground(
  fallback: ThemePreference = 'light',
): string {
  return colors[resolvePersistedThemeMode(fallback)].background;
}

/** Intro/splash/onboarding background for auth stack continuity. */
export function resolveStartupIntroBackground(
  fallback: ThemePreference = 'light',
): string {
  return resolveIntroColors(resolvePersistedThemeMode(fallback)).background;
}
