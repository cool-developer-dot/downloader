import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { SPLASH_COLORS } from '../constants/splash.constants';

export type SplashBackgroundProps = {
  backgroundColor?: string;
};

/** Full-screen intro background — color follows active theme intro policy. */
export const SplashBackground = memo(function SplashBackground({
  backgroundColor = SPLASH_COLORS.background,
}: SplashBackgroundProps) {
  return (
    <View
      pointerEvents="none"
      style={[styles.base, { backgroundColor }]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFill,
  },
});
