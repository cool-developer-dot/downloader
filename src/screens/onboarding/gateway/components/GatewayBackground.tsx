import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { resolveIntroColors } from '@/theme';

type GatewayBackgroundProps = {
  opacity: SharedValue<number>;
};

/**
 * Intro canvas — follows LIGHT / LOGO / DARK intro policy.
 */
export const GatewayBackground = memo(function GatewayBackground({
  opacity,
}: GatewayBackgroundProps) {
  const theme = useTheme();
  const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <View style={[styles.base, { backgroundColor: intro.background }]} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  base: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
});
