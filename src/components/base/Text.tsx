import { forwardRef, memo, useMemo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';
import type { TypographyVariant } from '@/theme/typography';

import type { TextColorToken } from './types';

export type TextProps = RNTextProps & {
  variant?: TypographyVariant;
  color?: TextColorToken;
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
};

export const Text = memo(
  forwardRef<RNText, TextProps>(function Text(
    { variant = 'body', color = 'textPrimary', align, style, children, ...rest },
    ref,
  ) {
    const theme = useTheme();
    const rtl = useRtl();

    const textStyle = useMemo<TextStyle>(
      () => ({
        ...theme.typography[variant],
        color: theme.colors[color],
        textAlign: align ?? rtl.textAlign,
        writingDirection: rtl.writingDirection,
      }),
      [align, color, rtl.textAlign, rtl.writingDirection, theme, variant],
    );

    return (
      <RNText ref={ref} style={[textStyle, style]} {...rest}>
        {children}
      </RNText>
    );
  }),
);
