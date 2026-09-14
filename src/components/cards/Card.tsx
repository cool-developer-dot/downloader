import { memo, type PropsWithChildren } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';
import type { ElevationToken } from '@/theme/elevation';
import type { RadiusToken } from '@/theme/radius';

export type CardProps = PropsWithChildren<{
  elevation?: ElevationToken;
  borderRadius?: RadiusToken;
  padding?: keyof typeof import('@/theme/spacing').spacing;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export const Card = memo(function Card({
  children,
  elevation = 'md',
  borderRadius = 'md',
  padding = 16,
  style,
  testID,
}: CardProps) {
  const theme = useTheme();

  return (
    <Box
      testID={testID}
      p={padding}
      borderRadius={borderRadius}
      backgroundColor="card"
      style={[theme.elevation[elevation], style]}>
      {children}
    </Box>
  );
});
