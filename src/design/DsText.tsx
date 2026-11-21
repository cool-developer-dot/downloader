import { memo, useMemo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';
import type { ColorTokenKey } from '@/theme';
import { nativeFontFamilies } from '@/theme/typography';

import { ds } from './tokens';

/** The design's text roles: size, line height and weight as measured; colour from the theme. */
export type DsTextVariant =
  | 'title'
  | 'subtitle'
  | 'rowTitle'
  | 'rowSub'
  | 'rowValue'
  | 'section'
  | 'chip'
  | 'chipSelected'
  | 'button'
  | 'tile'
  | 'body'
  | 'bodyStrong'
  | 'tabLabel'
  | 'hero'
  | 'stat'
  | 'cardTitle';

const SEMI = nativeFontFamilies.bodySemiBold;
const REG = nativeFontFamilies.body;

const VARIANTS: Record<DsTextVariant, TextStyle> = {
  title: { fontFamily: SEMI, fontSize: ds.text.title, lineHeight: ds.text.titleLine },
  subtitle: { fontFamily: REG, fontSize: ds.text.subtitle, lineHeight: ds.text.subtitleLine },
  rowTitle: { fontFamily: SEMI, fontSize: ds.text.rowTitle, lineHeight: ds.text.rowTitleLine },
  rowSub: { fontFamily: REG, fontSize: ds.text.rowSub, lineHeight: ds.text.rowSubLine },
  rowValue: { fontFamily: REG, fontSize: ds.text.rowValue, lineHeight: ds.text.rowSubLine },
  section: {
    fontFamily: SEMI,
    fontSize: ds.text.section,
    lineHeight: ds.text.sectionLine,
    letterSpacing: ds.text.sectionTracking,
    textTransform: 'uppercase',
  },
  chip: { fontFamily: REG, fontSize: ds.text.chip, lineHeight: ds.text.chipLine },
  chipSelected: { fontFamily: SEMI, fontSize: ds.text.chip, lineHeight: ds.text.chipLine },
  button: { fontFamily: SEMI, fontSize: ds.text.button, lineHeight: ds.text.rowTitleLine },
  tile: { fontFamily: SEMI, fontSize: ds.text.tile, lineHeight: ds.text.tileLine },
  body: { fontFamily: REG, fontSize: ds.text.body, lineHeight: ds.text.bodyLine },
  bodyStrong: { fontFamily: SEMI, fontSize: ds.text.body, lineHeight: ds.text.bodyLine },
  tabLabel: { fontFamily: SEMI, fontSize: ds.text.tabLabel, lineHeight: ds.text.tabLabelLine },
  hero: { fontFamily: SEMI, fontSize: ds.text.hero, lineHeight: ds.text.heroLine },
  stat: { fontFamily: SEMI, fontSize: ds.text.stat, lineHeight: ds.text.statLine },
  cardTitle: { fontFamily: SEMI, fontSize: ds.text.cardTitle, lineHeight: ds.text.cardTitleLine },
};

const DEFAULT_COLOR: Record<DsTextVariant, ColorTokenKey> = {
  title: 'textPrimary',
  subtitle: 'textSecondary',
  rowTitle: 'textPrimary',
  rowSub: 'textSecondary',
  rowValue: 'textSecondary',
  section: 'primary',
  chip: 'textPrimary',
  chipSelected: 'primary',
  button: 'textOnPrimary',
  tile: 'textPrimary',
  body: 'textSecondary',
  bodyStrong: 'textPrimary',
  tabLabel: 'bottomNavInactive',
  hero: 'textPrimary',
  stat: 'textPrimary',
  cardTitle: 'textPrimary',
};

export type DsTextProps = RNTextProps & {
  variant?: DsTextVariant;
  /** A theme colour token (default per variant), or an explicit colour string. */
  color?: ColorTokenKey | (string & {});
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
};

export const DsText = memo(function DsText({ variant = 'body', color, align, style, children, ...rest }: DsTextProps) {
  const theme = useTheme();
  const rtl = useRtl();
  const textStyle = useMemo<TextStyle>(() => {
    const token = color ?? DEFAULT_COLOR[variant];
    const resolved = token in theme.colors ? theme.colors[token as ColorTokenKey] : (token as string);
    return {
      ...VARIANTS[variant],
      color: resolved,
      textAlign: align ?? rtl.textAlign,
      writingDirection: rtl.writingDirection,
    };
  }, [align, color, rtl.textAlign, rtl.writingDirection, theme.colors, variant]);
  return (
    <RNText style={[textStyle, style]} {...rest}>
      {children}
    </RNText>
  );
});
