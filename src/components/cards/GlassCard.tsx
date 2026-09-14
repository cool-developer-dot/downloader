import { GlassView } from 'expo-glass-effect';
import { memo, type PropsWithChildren } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';

import { Box } from '@/components/base/Box';
import { useTheme } from '@/hooks/use-theme';
import type { RadiusToken } from '@/theme/radius';

export type GlassCardProps = PropsWithChildren<{
  borderRadius?: RadiusToken;
  padding?: keyof typeof import('@/theme/spacing').spacing;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export const GlassCard = memo(function GlassCard({
  children,
  borderRadius = 'lg',
  padding = 16,
  style,
  testID,
}: GlassCardProps) {
  const theme = useTheme();
  const radiusValue = theme.radius[borderRadius];

  if (Platform.OS === 'ios') {
    return (
      <GlassView
        testID={testID}
        style={[
          {
            borderRadius: radiusValue,
            overflow: 'hidden',
          },
          style,
        ]}>
        <Box p={padding}>{children}</Box>
      </GlassView>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        theme.elevation.md,
        {
          borderRadius: radiusValue,
          backgroundColor: theme.colors.card,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        style,
      ]}>
      <Box p={padding}>{children}</Box>
    </View>
  );
});
