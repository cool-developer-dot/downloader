import type { ColorTokenKey } from '@/theme';
import type { SpacingToken } from '@/theme/spacing';
import type { IconColorToken, IconSizeToken } from '@/theme/icons';
import type { TypographyVariant } from '@/theme/typography';

export type SpacingValue = SpacingToken | number;

export type BoxSpacingProps = {
  p?: SpacingValue;
  px?: SpacingValue;
  py?: SpacingValue;
  pt?: SpacingValue;
  pr?: SpacingValue;
  pb?: SpacingValue;
  pl?: SpacingValue;
  m?: SpacingValue;
  mx?: SpacingValue;
  my?: SpacingValue;
  mt?: SpacingValue;
  mr?: SpacingValue;
  mb?: SpacingValue;
  ml?: SpacingValue;
  gap?: SpacingValue;
};

export type TextColorToken = ColorTokenKey;

export type { IconColorToken, IconSizeToken, TypographyVariant };
