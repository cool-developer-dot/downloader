/**
 * Onboarding / intro decorative surface colors.
 *
 * Continuity policy — matches the selected theme through startup: the light themes (Light, Red, Cream, Blush)
 * build glass and chips over their own ink and accent; the dark themes (Dark, Midnight) over their own surfaces.
 */

import { colors, withAlpha, type ColorTokens, type ThemeMode } from './colors';
import { resolveIntroColors, type IntroColors } from './intro-palette';
import { isDarkThemeMode } from './theme-preference';

export type OnboardingSurfaces = IntroColors & {
  title: string;
  titleAccent: string;
  subtitle: string;
  logoGlow: string;
  radialGlow: string;
  glassBg: string;
  glassBorder: string;
  glassBorderActive: string;
  chipBg: string;
  chipBorder: string;
  chipText: string;
  chipIcon: string;
  softWhite: string;
  accentSoft: string;
  accentGlow: string;
  progressTrack: string;
  libraryBorder: string;
  libraryBg: string;
  libraryLabel: string;
  libraryLabelActive: string;
  searchBg: string;
  searchBorder: string;
  searchPlaceholder: string;
  searchText: string;
  caret: string;
  waveform: string;
  heroEnergy: string;
  heroBeam: string;
  heroGlassBg: string;
  footerMuted: string;
  footerActive: string;
};

/**
 * Dark onboarding contract — aligned with private-app Dark tokens.
 * Kept as an export for verifiers / docs (no longer an olive allowlist).
 */
export const DARK_ONBOARDING_ALLOWLIST = {
  background: colors.dark.background,
  brandText: colors.dark.textPrimary,
  taglineText: colors.dark.textSecondary,
  accent: colors.dark.primary,
  title: colors.dark.textPrimary,
  titleAccent: colors.dark.primary,
} as const;

function buildLightSurfaces(c: ColorTokens, intro: IntroColors): OnboardingSurfaces {
  const accent = c.primary;
  const ink = c.textPrimary;
  const muted = c.textSecondary;
  return {
    ...intro,
    title: ink,
    titleAccent: accent,
    subtitle: withAlpha(ink, 0.62),
    logoGlow: withAlpha(accent, 0.14),
    radialGlow: withAlpha(accent, 0.1),
    glassBg: withAlpha(c.card, 0.96),
    glassBorder: withAlpha(ink, 0.1),
    glassBorderActive: withAlpha(accent, 0.35),
    chipBg: withAlpha(ink, 0.04),
    chipBorder: withAlpha(ink, 0.08),
    chipText: withAlpha(ink, 0.82),
    chipIcon: withAlpha(ink, 0.7),
    softWhite: withAlpha(ink, 0.92),
    accentSoft: withAlpha(accent, 0.16),
    accentGlow: withAlpha(accent, 0.28),
    progressTrack: withAlpha(ink, 0.12),
    libraryBorder: withAlpha(ink, 0.08),
    libraryBg: withAlpha(ink, 0.04),
    libraryLabel: withAlpha(ink, 0.5),
    libraryLabelActive: withAlpha(ink, 0.82),
    searchBg: c.card,
    searchBorder: withAlpha(ink, 0.1),
    searchPlaceholder: muted,
    searchText: ink,
    caret: accent,
    waveform: withAlpha(accent, 0.85),
    heroEnergy: withAlpha(accent, 0.88),
    heroBeam: withAlpha(accent, 0.22),
    heroGlassBg: withAlpha(c.card, 0.92),
    footerMuted: muted,
    footerActive: ink,
  };
}

function buildDarkSurfaces(c: ColorTokens, intro: IntroColors): OnboardingSurfaces {
  const ink = c.textPrimary;
  const muted = c.textSecondary;
  const accent = c.primary;
  const surface = c.surface;
  return {
    ...intro,
    title: ink,
    titleAccent: accent,
    subtitle: withAlpha(ink, 0.72),
    logoGlow: withAlpha(accent, 0.14),
    radialGlow: withAlpha(accent, 0.1),
    glassBg: withAlpha(surface, 0.94),
    glassBorder: withAlpha(ink, 0.1),
    glassBorderActive: withAlpha(accent, 0.32),
    chipBg: withAlpha(ink, 0.06),
    chipBorder: withAlpha(ink, 0.08),
    chipText: withAlpha(ink, 0.82),
    chipIcon: withAlpha(muted, 0.9),
    softWhite: withAlpha(ink, 0.92),
    accentSoft: withAlpha(accent, 0.16),
    accentGlow: withAlpha(accent, 0.28),
    progressTrack: withAlpha(ink, 0.14),
    libraryBorder: withAlpha(ink, 0.08),
    libraryBg: withAlpha(ink, 0.05),
    libraryLabel: withAlpha(muted, 0.7),
    libraryLabelActive: withAlpha(ink, 0.88),
    searchBg: c.surfaceElevated,
    searchBorder: withAlpha(ink, 0.1),
    searchPlaceholder: muted,
    searchText: ink,
    caret: accent,
    waveform: withAlpha(accent, 0.85),
    heroEnergy: withAlpha(accent, 0.88),
    heroBeam: withAlpha(accent, 0.2),
    heroGlassBg: withAlpha(surface, 0.92),
    footerMuted: intro.muted,
    footerActive: intro.active,
  };
}

export function resolveOnboardingSurfaces(mode: ThemeMode): OnboardingSurfaces {
  const intro = resolveIntroColors(mode);
  const c = colors[mode] ?? colors.light;
  return isDarkThemeMode(mode) ? buildDarkSurfaces(c, intro) : buildLightSurfaces(c, intro);
}
