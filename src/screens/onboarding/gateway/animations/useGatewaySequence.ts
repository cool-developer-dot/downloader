import { useEffect } from 'react';
import {
  cancelAnimation,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GATEWAY_EASING, GATEWAY_MOTION, GATEWAY_TIMINGS } from './timings';

export type GatewaySequenceValues = {
  backgroundOpacity: SharedValue<number>;
  logoOpacity: SharedValue<number>;
  logoScale: SharedValue<number>;
  logoTranslateY: SharedValue<number>;
  logoGlow: SharedValue<number>;
  logoBreath: SharedValue<number>;
  copyOpacity: SharedValue<number>;
  copyTranslateY: SharedValue<number>;
  footerOpacity: SharedValue<number>;
};

type Options = {
  enabled?: boolean;
};

function delayedTiming(
  toValue: number,
  delay: number,
  duration: number,
  easing = GATEWAY_EASING.softOut,
) {
  'worklet';
  return withDelay(delay, withTiming(toValue, { duration, easing }));
}

/** Logo / copy / chrome choreography (ecosystem icons are separate). */
export function useGatewaySequence({ enabled = true }: Options = {}): GatewaySequenceValues {
  const backgroundOpacity = useSharedValue(0);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue<number>(GATEWAY_MOTION.logoScaleFrom);
  const logoTranslateY = useSharedValue<number>(GATEWAY_MOTION.logoTranslateFrom);
  const logoGlow = useSharedValue(0);
  const logoBreath = useSharedValue(1);
  const copyOpacity = useSharedValue(0);
  const copyTranslateY = useSharedValue<number>(10);
  const footerOpacity = useSharedValue(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    backgroundOpacity.value = delayedTiming(
      1,
      GATEWAY_TIMINGS.background.delay,
      GATEWAY_TIMINGS.background.duration,
    );

    logoOpacity.value = delayedTiming(1, GATEWAY_TIMINGS.logo.delay, GATEWAY_TIMINGS.logo.duration);
    logoScale.value = delayedTiming(
      GATEWAY_MOTION.logoScaleTo,
      GATEWAY_TIMINGS.logo.delay,
      GATEWAY_TIMINGS.logo.duration,
    );
    logoTranslateY.value = delayedTiming(
      GATEWAY_MOTION.logoTranslateTo,
      GATEWAY_TIMINGS.logo.delay,
      GATEWAY_TIMINGS.logo.duration,
    );
    logoGlow.value = delayedTiming(
      1,
      GATEWAY_TIMINGS.logo.delay + 80,
      GATEWAY_TIMINGS.logo.duration,
      GATEWAY_EASING.softInOut,
    );

    logoBreath.value = withDelay(
      GATEWAY_TIMINGS.logoBreathStart,
      withRepeat(
        withSequence(
          withTiming(GATEWAY_MOTION.logoBreathMax, {
            duration: GATEWAY_MOTION.logoBreathMs / 2,
            easing: GATEWAY_EASING.softInOut,
          }),
          withTiming(GATEWAY_MOTION.logoBreathMin, {
            duration: GATEWAY_MOTION.logoBreathMs / 2,
            easing: GATEWAY_EASING.softInOut,
          }),
        ),
        -1,
        false,
      ),
    );

    logoGlow.value = withDelay(
      GATEWAY_TIMINGS.logoFocusGlow.delay,
      withTiming(1.4, {
        duration: GATEWAY_TIMINGS.logoFocusGlow.duration,
        easing: GATEWAY_EASING.softInOut,
      }),
    );

    copyOpacity.value = delayedTiming(1, GATEWAY_TIMINGS.copy.delay, GATEWAY_TIMINGS.copy.duration);
    copyTranslateY.value = delayedTiming(0, GATEWAY_TIMINGS.copy.delay, GATEWAY_TIMINGS.copy.duration);

    footerOpacity.value = delayedTiming(
      1,
      GATEWAY_TIMINGS.footer.delay,
      GATEWAY_TIMINGS.footer.duration,
    );

    return () => {
      cancelAnimation(backgroundOpacity);
      cancelAnimation(logoOpacity);
      cancelAnimation(logoScale);
      cancelAnimation(logoTranslateY);
      cancelAnimation(logoGlow);
      cancelAnimation(logoBreath);
      cancelAnimation(copyOpacity);
      cancelAnimation(copyTranslateY);
      cancelAnimation(footerOpacity);
    };
  }, [
    backgroundOpacity,
    copyOpacity,
    copyTranslateY,
    enabled,
    footerOpacity,
    logoBreath,
    logoGlow,
    logoOpacity,
    logoScale,
    logoTranslateY,
  ]);

  return {
    backgroundOpacity,
    logoOpacity,
    logoScale,
    logoTranslateY,
    logoGlow,
    logoBreath,
    copyOpacity,
    copyTranslateY,
    footerOpacity,
  };
}
