import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { resolveIntroColors, withAlpha } from '@/theme';

import { LIBRARY_LAYOUT } from '../constants';

type LibraryBackgroundProps = {
  opacity: SharedValue<number>;
  ambientGlow: SharedValue<number>;
};

export const LibraryBackground = memo(function LibraryBackground({
  opacity,
  ambientGlow,
}: LibraryBackgroundProps) {
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
    top: '16%',
    alignSelf: 'center',
    left: '50%',
    marginLeft: -LIBRARY_LAYOUT.glowSize / 2,
    width: LIBRARY_LAYOUT.glowSize,
    height: LIBRARY_LAYOUT.glowSize,
    borderRadius: LIBRARY_LAYOUT.glowSize / 2,
  },
});
