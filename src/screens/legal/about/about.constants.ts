import { BRAND_LOGO_SIZES, VIDORAX_LOGO } from '@/constants/brand-assets';

export const ABOUT_LOGO = VIDORAX_LOGO;

export const ABOUT_LAYOUT = {
  logoSize: BRAND_LOGO_SIZES.lg,
  sectionGap: 28,
  identityGap: 12,
  cardPaddingX: 20,
  cardPaddingY: 6,
  rowMinHeight: 56,
  iconBox: 40,
  iconRadius: 12,
} as const;
