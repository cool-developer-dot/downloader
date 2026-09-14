import { forwardRef, memo, useMemo } from 'react';
import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useRtl } from '@/localization';
import type { RadiusToken } from '@/theme/radius';

import { resolveBoxSpacing } from './spacing-utils';
import type { BoxSpacingProps } from './types';

export type BoxProps = ViewProps &
  BoxSpacingProps & {
    backgroundColor?: keyof ReturnType<typeof useTheme>['colors'];
    borderColor?: keyof ReturnType<typeof useTheme>['colors'];
    borderWidth?: number;
    borderRadius?: RadiusToken | number;
    flex?: number;
    row?: boolean;
    /** When true with `row`, mirrors start/end for RTL without flipping media controls. */
    rtlRow?: boolean;
    center?: boolean;
    style?: StyleProp<ViewStyle>;
  };

export const Box = memo(
  forwardRef<View, BoxProps>(function Box(
    {
      p,
      px,
      py,
      pt,
      pr,
      pb,
      pl,
      m,
      mx,
      my,
      mt,
      mr,
      mb,
      ml,
      gap,
      backgroundColor,
      borderColor,
      borderWidth,
      borderRadius,
      flex,
      row,
      rtlRow = false,
      center,
      style,
      children,
      ...rest
    },
    ref,
  ) {
    const theme = useTheme();
    const rtl = useRtl();

    const boxStyle = useMemo<ViewStyle>(() => {
      const spacingStyle = resolveBoxSpacing({
        p,
        px,
        py,
        pt,
        pr,
        pb,
        pl,
        m,
        mx,
        my,
        mt,
        mr,
        mb,
        ml,
        gap,
      });

      const radiusValue =
        borderRadius === undefined
          ? undefined
          : typeof borderRadius === 'number'
            ? borderRadius
            : theme.radius[borderRadius];

      return {
        ...spacingStyle,
        flex,
        flexDirection: row ? (rtlRow ? rtl.rowDirection : 'row') : undefined,
        alignItems: center ? 'center' : undefined,
        justifyContent: center ? 'center' : undefined,
        backgroundColor: backgroundColor ? theme.colors[backgroundColor] : undefined,
        borderColor: borderColor ? theme.colors[borderColor] : undefined,
        borderWidth,
        borderRadius: radiusValue,
      };
    }, [
      backgroundColor,
      borderColor,
      borderRadius,
      borderWidth,
      center,
      flex,
      gap,
      m,
      mb,
      ml,
      mr,
      mt,
      mx,
      my,
      p,
      pb,
      pl,
      pr,
      pt,
      px,
      py,
      row,
      rtl.rowDirection,
      rtlRow,
      theme,
    ]);

    return (
      <View ref={ref} style={[boxStyle, style]} {...rest}>
        {children}
      </View>
    );
  }),
);
