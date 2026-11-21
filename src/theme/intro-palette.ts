/**
 * Intro / splash / onboarding color resolution: every theme's intro follows that theme's page, text and accent, so
 * the app starts in the colours it will show.
 */

import { colors, withAlpha, type ThemeMode } from './colors';
import { isDarkThemeMode } from './theme-preference';

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

function buildIntro(mode: ThemeMode): IntroColors {
  const c = colors[mode];
  return {
    background: c.background,
    brandText: c.textPrimary,
    taglineText: c.primary,
    taglineDot: withAlpha(c.primary, 0.35),
    loaderTrack: withAlpha(c.textPrimary, 0.12),
    loaderFill: c.primary,
    muted: c.textSecondary,
    active: c.textPrimary,
    accent: c.primary,
    dotInactive: withAlpha(c.textSecondary, 0.35),
    statusBarStyle: isDarkThemeMode(mode) ? 'light-content' : 'dark-content',
  };
}

const INTROS: Record<ThemeMode, IntroColors> = {
  light: buildIntro('light'),
  dark: buildIntro('dark'),
  red: buildIntro('red'),
  cream: buildIntro('cream'),
  midnight: buildIntro('midnight'),
  blush: buildIntro('blush'),
};

export function resolveIntroColors(mode: ThemeMode): IntroColors {
  return INTROS[mode] ?? INTROS.light;
}
