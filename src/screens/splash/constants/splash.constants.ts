import { VIDORAX_LOGO } from '@/constants/brand-assets';
import { colors, withAlpha, type ThemeMode } from '@/theme/colors';
import { resolveIntroColors, type IntroColors } from '@/theme/intro-palette';

export const SPLASH_LOGO = VIDORAX_LOGO;

/**
 * The branded splash follows the app theme (`resolveIntroColors(theme.mode)`: Light / Logo → white with a dark
 * wordmark, Dark → #0D0D0D with a light one, System → the device's), exactly like the native launch screen before it
 * (colors.xml `splashscreen_background` + drawable[-night]/splashscreen_logo.png): one continuous launch, never a
 * white or black flash between the two.
 */
export function resolveSplashIntro(mode: ThemeMode): IntroColors {
  return resolveIntroColors(mode);
}

export const SPLASH_BRAND_LETTERS = ['V', 'i', 'd', 'o', 'r', 'a', 'X'] as const;

export const SPLASH_COPY = {
  brandName: 'VidoraX',
  taglineWords: ['Fast', 'Reliable', 'Secure'] as const,
} as const;

/**
 * Deprecated static defaults — prefer `resolveIntroColors(mode)`.
 * Kept as LIGHT-neutral fallbacks so accidental use never paints olive.
 */
export const SPLASH_COLORS = {
  background: colors.light.background,
  brandText: colors.light.textPrimary,
  taglineText: colors.light.textSecondary,
  taglineDot: withAlpha(colors.light.textSecondary, 0.35),
  loaderTrack: withAlpha(colors.light.textPrimary, 0.12),
  loaderFill: colors.light.primary,
} as const;

export const SPLASH_LAYOUT = {
  /**
   * The logo image has a transparent margin (512 px plate on a 544 px canvas): 119 dp shows a 112 dp plate, the same
   * size as on the native launch screen (scripts/dev/render-native-splash.py).
   */
  logoSize: 119,
  brandFontSize: 34,
  brandLetterSpacing: 1.2,
  taglineFontSize: 13,
  taglineLetterSpacing: 0.6,
  loaderWidth: 200,
  loaderHeight: 2,
  letterGap: 1,
} as const;
