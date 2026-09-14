import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { resolveIntroColors, withAlpha } from '@/theme';

import { TRUST_LAYOUT } from '../constants';

type TrustBackgroundProps = {
  opacity: SharedValue<number>;
  ambientGlow: SharedValue<number>;
};

/**
 * Intro canvas with soft radial accent — theme-aware via intro policy.
 */
export const TrustBackground = memo(function TrustBackground({
  opacity,
  ambientGlow,
}: TrustBackgroundProps) {
  const theme = useTheme();
  const intro = useMemo(() => resolveIntroColors(theme.mode), [theme.mode]);
  const canvasStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: ambientGlow.value,
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, canvasStyle]}>
      <View style={[styles.base, { backgroundColor: intro.background }]} />
      <Animated.View
        style={[
          styles.glow,
          { backgroundColor: withAlpha(intro.accent, 0.12) },
          glowStyle,
        ]}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFill,
  },
  glow: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    left: '50%',
    marginLeft: -TRUST_LAYOUT.glowSize / 2,
    width: TRUST_LAYOUT.glowSize,
    height: TRUST_LAYOUT.glowSize,
    borderRadius: TRUST_LAYOUT.glowSize / 2,
  },
});
