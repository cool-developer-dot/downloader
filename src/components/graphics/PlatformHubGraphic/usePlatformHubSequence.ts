import { useCallback, useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  getPlatformHubConnectionDelay,
  getPlatformHubIconEnterDelay,
  PLATFORM_HUB_EASING,
  PLATFORM_HUB_MOTION,
  PLATFORM_HUB_TIMINGS,
} from './animations';
import type { PlatformHubIconAnim } from './types';
import { usePlatformHubIconAnims } from './usePlatformHubIconAnim';

export type PlatformHubSequence = {
  icons: PlatformHubIconAnim[];
  focusOpacity: SharedValue<number>;
};

type Options = { enabled?: boolean };

function delayedTiming(
  toValue: number,
  delay: number,
  duration: number,
  easing = PLATFORM_HUB_EASING.softOut,
) {
  'worklet';
  return withDelay(delay, withTiming(toValue, { duration, easing }));
}

/** Nine-icon hybrid orbit choreography for the platform hub graphic. */
export function usePlatformHubSequence({ enabled = true }: Options = {}): PlatformHubSequence {
  const icons = usePlatformHubIconAnims();
  const focusOpacity = useSharedValue(1);

  const startFloat = useCallback((icon: PlatformHubIconAnim, index: number) => {
    const amp =
      PLATFORM_HUB_MOTION.floatAmplitudeMin +
      ((index * 37) % 10) *
        ((PLATFORM_HUB_MOTION.floatAmplitudeMax - PLATFORM_HUB_MOTION.floatAmplitudeMin) / 10);
    const durX = 3600 + index * 290;
    const durY = 4300 + index * 210;
    const phase = index * 170;
    const ax = amp * 0.55;
    const ay = amp * 0.55;

    icon.floatX.value = withDelay(
      PLATFORM_HUB_TIMINGS.floatStart + phase,
      withRepeat(
        withSequence(
          withTiming(ax, { duration: durX, easing: PLATFORM_HUB_EASING.softInOut }),
          withTiming(-ax, { duration: durX, easing: PLATFORM_HUB_EASING.softInOut }),
        ),
        -1,
        true,
      ),
    );

    icon.floatY.value = withDelay(
      PLATFORM_HUB_TIMINGS.floatStart + phase + 110,
      withRepeat(
        withSequence(
          withTiming(-ay, { duration: durY, easing: PLATFORM_HUB_EASING.softInOut }),
          withTiming(ay, { duration: durY, easing: PLATFORM_HUB_EASING.softInOut }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    icons.forEach((icon, index) => {
      const delay = getPlatformHubIconEnterDelay(index);
      icon.opacity.value = delayedTiming(1, delay, PLATFORM_HUB_TIMINGS.icons.duration);
      icon.scale.value = delayedTiming(1, delay, PLATFORM_HUB_TIMINGS.icons.duration);
      icon.enterX.value = delayedTiming(0, delay, PLATFORM_HUB_TIMINGS.icons.duration);
      icon.enterY.value = delayedTiming(0, delay, PLATFORM_HUB_TIMINGS.icons.duration);

      icon.connection.value = withDelay(
        getPlatformHubConnectionDelay(index),
        withTiming(1, {
          duration: PLATFORM_HUB_TIMINGS.connections.duration,
          easing: Easing.out(Easing.cubic),
        }),
      );

      startFloat(icon, index);
    });

    focusOpacity.value = delayedTiming(
      PLATFORM_HUB_MOTION.dimOpacity,
      PLATFORM_HUB_TIMINGS.focus.delay,
      PLATFORM_HUB_TIMINGS.focus.duration,
      PLATFORM_HUB_EASING.softInOut,
    );

    return () => {
      cancelAnimation(focusOpacity);
      icons.forEach((icon) => {
        cancelAnimation(icon.opacity);
        cancelAnimation(icon.scale);
        cancelAnimation(icon.enterX);
        cancelAnimation(icon.enterY);
        cancelAnimation(icon.floatX);
        cancelAnimation(icon.floatY);
        cancelAnimation(icon.connection);
      });
    };
  }, [enabled, focusOpacity, icons, startFloat]);

  return { icons, focusOpacity };
}
