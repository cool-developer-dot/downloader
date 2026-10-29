import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle } from 'react-native-reanimated';

import { Icon } from '@/components/base/Icon';
import { SWIPE_TRIGGER_DP } from '@/browser/navigation/swipe-navigation';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

import type { SwipeNavigationShared } from './useSwipeNavigation';

const SIZE = 44;

/**
 * B6 #45: the arrow that follows a navigation swipe — on the side the page comes from (Back: the reading start), it
 * grows with the swipe and fills when releasing would navigate. Nothing shows when there is nowhere to go.
 */
export const SwipeArrow = memo(function SwipeArrow({
  shared,
  bottom,
}: {
  shared: SwipeNavigationShared;
  bottom: number;
}) {
  const theme = useTheme();
  const { rtl } = useTranslation();
  const isRtl = rtl.isRtl;
  const card = theme.colors.card;
  const primary = theme.colors.primary;

  const backStyle = useAnimatedStyle(() => {
    const dx = shared.dx.value;
    const back = isRtl ? dx < 0 : dx > 0;
    const progress = back && shared.canGoBack.value ? Math.min(1, Math.abs(dx) / SWIPE_TRIGGER_DP) : 0;
    return {
      opacity: progress,
      transform: [{ scale: 0.6 + 0.4 * progress }],
      backgroundColor: interpolateColor(progress >= 1 ? 1 : 0, [0, 1], [card, primary]),
    };
  });
  const forwardStyle = useAnimatedStyle(() => {
    const dx = shared.dx.value;
    const forward = isRtl ? dx > 0 : dx < 0;
    const progress = forward && shared.canGoForward.value ? Math.min(1, Math.abs(dx) / SWIPE_TRIGGER_DP) : 0;
    return {
      opacity: progress,
      transform: [{ scale: 0.6 + 0.4 * progress }],
      backgroundColor: interpolateColor(progress >= 1 ? 1 : 0, [0, 1], [card, primary]),
    };
  });

  // Back sits on the reading-start side (left in English, right in Urdu).
  const backSide = isRtl ? { right: 16 } : { left: 16 };
  const forwardSide = isRtl ? { left: 16 } : { right: 16 };

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 40 }]} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.bubble, { bottom, ...backSide, ...theme.elevation.md }, backStyle]}>
        <Icon name={rtl.arrowBack} size={24} color="default" />
      </Animated.View>
      <Animated.View style={[styles.bubble, { bottom, ...forwardSide, ...theme.elevation.md }, forwardStyle]}>
        <Icon name={rtl.arrowForward} size={24} color="default" />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
