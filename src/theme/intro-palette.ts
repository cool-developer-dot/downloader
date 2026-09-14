/**
 * Intro / splash / onboarding color resolution.
 *
 * Continuity policy — all modes follow the selected app theme:
 * - LIGHT → white / black / gray
 * - LOGO → white/light + brand red accents (#DC3C2C)
 * - DARK → neutral black / charcoal / white / gray (NO olive/sage)
 */

import { brandPalette, colors, withAlpha, type ThemeMode } from './colors';

export type IntroColors = {
  background: string;
  brandText: string;
  taglineText: string;
  taglineDot: string;
  loaderTrack: string;
  loaderFill: string;
  muted: string;
  active: string;
  accent: string;
  dotInactive: string;
  statusBarStyle: 'light-content' | 'dark-content';
};

const LIGHT_INTRO: IntroColors = {
  background: colors.light.background,
  brandText: colors.light.textPrimary,
  taglineText: colors.light.primaryDark,
  taglineDot: withAlpha(colors.light.primary, 0.35),
  loaderTrack: withAlpha(colors.light.textPrimary, 0.12),
  loaderFill: colors.light.primary,
  muted: colors.light.textSecondary,
  active: colors.light.textPrimary,
  accent: colors.light.primary,
  dotInactive: withAlpha(colors.light.textSecondary, 0.35),
  statusBarStyle: 'dark-content',
};

const LOGO_INTRO: IntroColors = {
  background: colors.logo.background,
  brandText: colors.logo.textPrimary,
  taglineText: brandPalette.brandRed,
  taglineDot: withAlpha(brandPalette.brandRed, 0.35),
  loaderTrack: withAlpha(colors.logo.textPrimary, 0.12),
  loaderFill: brandPalette.brandRed,
  muted: colors.logo.textSecondary,
  active: colors.logo.textPrimary,
  accent: brandPalette.brandRed,
  dotInactive: withAlpha(colors.logo.textSecondary, 0.35),
  statusBarStyle: 'dark-content',
};

/** Dark intro uses the same neutral Dark private-app palette (startup continuity). */
const DARK_INTRO: IntroColors = {
  background: colors.dark.background,
  brandText: colors.dark.textPrimary,
  taglineText: colors.dark.textSecondary,
  taglineDot: withAlpha(colors.dark.textSecondary, 0.35),
  loaderTrack: withAlpha(colors.dark.textPrimary, 0.12),
  loaderFill: colors.dark.primary,
  muted: colors.dark.textSecondary,
  active: colors.dark.textPrimary,
  accent: colors.dark.primary,
  dotInactive: withAlpha(colors.dark.textSecondary, 0.35),
  statusBarStyle: 'light-content',
};

export function resolveIntroColors(mode: ThemeMode): IntroColors {
  if (mode === 'logo') {
    return LOGO_INTRO;
  }
  if (mode === 'light') {
    return LIGHT_INTRO;
  }
  return DARK_INTRO;
}
