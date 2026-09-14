import {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useCallback, useEffect, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import { DISCOVERY_ANIMATION } from '../quality';

type UseDiscoveryCardAnimationArgs = {
  visible: boolean;
  reducedMotion: boolean;
  mediaId: string | null;
  onSwipeDismiss: () => void;
};

/**
 * Enter/exit + swipe-down dismiss. Native-driven, reduce-motion aware.
 */
export function useDiscoveryCardAnimation({
  visible,
  reducedMotion,
  mediaId,
  onSwipeDismiss,
}: UseDiscoveryCardAnimationArgs) {
  const progress = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dismissing = useSharedValue(0);

  useEffect(() => {
    cancelAnimation(progress);
    cancelAnimation(dragY);

    if (!visible) {
      progress.value = withTiming(0, {
        duration: reducedMotion ? 0 : DISCOVERY_ANIMATION.exitMs,
        easing: Easing.in(Easing.cubic),
      });
      dragY.value = withTiming(0, {
        duration: reducedMotion ? 0 : DISCOVERY_ANIMATION.exitMs,
      });
      dismissing.value = 0;
      return;
    }

    dragY.value = 0;
    dismissing.value = 0;

    if (reducedMotion) {
      progress.value = 1;
      return;
    }

    progress.value = withTiming(1, {
      duration: DISCOVERY_ANIMATION.enterMs,
      easing: Easing.out(Easing.cubic),
    });
  }, [visible, reducedMotion, mediaId, progress, dragY, dismissing]);

  useEffect(() => {
    return () => {
      cancelAnimation(progress);
      cancelAnimation(dragY);
    };
  }, [progress, dragY]);

  const triggerDismiss = useCallback(() => {
    onSwipeDismiss();
  }, [onSwipeDismiss]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!reducedMotion)
        // Require clear vertical intent so Android taps on CTAs are not claimed.
        .activeOffsetY(12)
        .failOffsetX([-20, 20])
        // Shared-value writes are intentional Reanimated worklet mutations.
        /* eslint-disable react-hooks/immutability */
        .onUpdate((event) => {
          'worklet';
          if (dismissing.value) {
            return;
          }
          dragY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          'worklet';
          if (dismissing.value) {
            return;
          }

          const shouldDismiss =
            dragY.value >= DISCOVERY_ANIMATION.swipeDismissThreshold ||
            event.velocityY >= DISCOVERY_ANIMATION.swipeVelocityThreshold;

          if (shouldDismiss) {
            dismissing.value = 1;
            dragY.value = withTiming(
              dragY.value + 140,
              {
                duration: DISCOVERY_ANIMATION.exitMs,
                easing: Easing.in(Easing.cubic),
              },
              (finished) => {
                if (finished) {
                  runOnJS(triggerDismiss)();
                }
              },
            );
            progress.value = withTiming(0, {
              duration: DISCOVERY_ANIMATION.exitMs,
              easing: Easing.in(Easing.cubic),
            });
            return;
          }

          dragY.value = withSpring(0, {
            damping: 22,
            stiffness: 260,
            mass: 0.8,
          });
        }),
    /* eslint-enable react-hooks/immutability */
    [reducedMotion, triggerDismiss, dragY, dismissing, progress],
  );

  const cardStyle = useAnimatedStyle(() => {
    const enterY = (1 - progress.value) * DISCOVERY_ANIMATION.cardTranslateY;
    const opacity = Math.max(0, progress.value * (1 - dragY.value / 220));
    return {
      opacity,
      transform: [
        { translateY: enterY + dragY.value },
        { scale: 0.97 + progress.value * 0.03 },
      ],
    };
  });

  return { cardStyle, panGesture, progress, dragY };
}
