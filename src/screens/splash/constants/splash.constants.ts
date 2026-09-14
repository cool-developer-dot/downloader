import { BRAND_LOGO_SIZES, VIDORAX_LOGO } from '@/constants/brand-assets';
import { colors, withAlpha } from '@/theme/colors';

export const SPLASH_LOGO = VIDORAX_LOGO;

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
  logoSize: BRAND_LOGO_SIZES.xl,
  brandFontSize: 34,
  brandLetterSpacing: 1.2,
  taglineFontSize: 13,
  taglineLetterSpacing: 3.2,
  loaderWidth: 200,
  loaderHeight: 2,
  letterGap: 1,
} as const;
