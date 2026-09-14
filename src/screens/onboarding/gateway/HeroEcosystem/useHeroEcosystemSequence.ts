import { useCallback, useEffect, useMemo } from 'react';
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
  getHeroConnectionDelay,
  getHeroIconEnterDelay,
  HERO_ECOSYSTEM_EASING,
  HERO_ECOSYSTEM_TIMINGS,
} from './animations';
import {
  HERO_ECOSYSTEM_MOTION,
  HERO_ORBIT_ITEMS,
} from './constants';

export type HeroIconAnim = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  enterX: SharedValue<number>;
  enterY: SharedValue<number>;
  floatX: SharedValue<number>;
  floatY: SharedValue<number>;
  connection: SharedValue<number>;
};

export type HeroEcosystemSequence = {
  icons: HeroIconAnim[];
  focusOpacity: SharedValue<number>;
};

type Options = { enabled?: boolean };

function delayedTiming(
  toValue: number,
  delay: number,
  duration: number,
  easing = HERO_ECOSYSTEM_EASING.softOut,
) {
  'worklet';
  return withDelay(delay, withTiming(toValue, { duration, easing }));
}

/** 8-icon hybrid orbit choreography. */
export function useHeroEcosystemSequence({ enabled = true }: Options = {}): HeroEcosystemSequence {
  const o0 = useSharedValue(0);
  const o1 = useSharedValue(0);
  const o2 = useSharedValue(0);
  const o3 = useSharedValue(0);
  const o4 = useSharedValue(0);
  const o5 = useSharedValue(0);
  const o6 = useSharedValue(0);
  const o7 = useSharedValue(0);

  const s0 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s1 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s2 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s3 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s4 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s5 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s6 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);
  const s7 = useSharedValue<number>(HERO_ECOSYSTEM_MOTION.enterScaleFrom);

  const ex0 = useSharedValue<number>(HERO_ORBIT_ITEMS[0].enterDx);
  const ex1 = useSharedValue<number>(HERO_ORBIT_ITEMS[1].enterDx);
  const ex2 = useSharedValue<number>(HERO_ORBIT_ITEMS[2].enterDx);
  const ex3 = useSharedValue<number>(HERO_ORBIT_ITEMS[3].enterDx);
  const ex4 = useSharedValue<number>(HERO_ORBIT_ITEMS[4].enterDx);
  const ex5 = useSharedValue<number>(HERO_ORBIT_ITEMS[5].enterDx);
  const ex6 = useSharedValue<number>(HERO_ORBIT_ITEMS[6].enterDx);
  const ex7 = useSharedValue<number>(HERO_ORBIT_ITEMS[7].enterDx);

  const ey0 = useSharedValue<number>(HERO_ORBIT_ITEMS[0].enterDy);
  const ey1 = useSharedValue<number>(HERO_ORBIT_ITEMS[1].enterDy);
  const ey2 = useSharedValue<number>(HERO_ORBIT_ITEMS[2].enterDy);
  const ey3 = useSharedValue<number>(HERO_ORBIT_ITEMS[3].enterDy);
  const ey4 = useSharedValue<number>(HERO_ORBIT_ITEMS[4].enterDy);
  const ey5 = useSharedValue<number>(HERO_ORBIT_ITEMS[5].enterDy);
  const ey6 = useSharedValue<number>(HERO_ORBIT_ITEMS[6].enterDy);
  const ey7 = useSharedValue<number>(HERO_ORBIT_ITEMS[7].enterDy);

  const fx0 = useSharedValue(0);
  const fx1 = useSharedValue(0);
  const fx2 = useSharedValue(0);
  const fx3 = useSharedValue(0);
  const fx4 = useSharedValue(0);
  const fx5 = useSharedValue(0);
  const fx6 = useSharedValue(0);
  const fx7 = useSharedValue(0);

  const fy0 = useSharedValue(0);
  const fy1 = useSharedValue(0);
  const fy2 = useSharedValue(0);
  const fy3 = useSharedValue(0);
  const fy4 = useSharedValue(0);
  const fy5 = useSharedValue(0);
  const fy6 = useSharedValue(0);
  const fy7 = useSharedValue(0);

  const c0 = useSharedValue(0);
  const c1 = useSharedValue(0);
  const c2 = useSharedValue(0);
  const c3 = useSharedValue(0);
  const c4 = useSharedValue(0);
  const c5 = useSharedValue(0);
  const c6 = useSharedValue(0);
  const c7 = useSharedValue(0);

  const icons = useMemo<HeroIconAnim[]>(
    () => [
      { opacity: o0, scale: s0, enterX: ex0, enterY: ey0, floatX: fx0, floatY: fy0, connection: c0 },
      { opacity: o1, scale: s1, enterX: ex1, enterY: ey1, floatX: fx1, floatY: fy1, connection: c1 },
      { opacity: o2, scale: s2, enterX: ex2, enterY: ey2, floatX: fx2, floatY: fy2, connection: c2 },
      { opacity: o3, scale: s3, enterX: ex3, enterY: ey3, floatX: fx3, floatY: fy3, connection: c3 },
      { opacity: o4, scale: s4, enterX: ex4, enterY: ey4, floatX: fx4, floatY: fy4, connection: c4 },
      { opacity: o5, scale: s5, enterX: ex5, enterY: ey5, floatX: fx5, floatY: fy5, connection: c5 },
      { opacity: o6, scale: s6, enterX: ex6, enterY: ey6, floatX: fx6, floatY: fy6, connection: c6 },
      { opacity: o7, scale: s7, enterX: ex7, enterY: ey7, floatX: fx7, floatY: fy7, connection: c7 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const focusOpacity = useSharedValue(1);

  const startFloat = useCallback((icon: HeroIconAnim, index: number) => {
    // Tiny tangential-biased drift keeps perceived radius stable while staying alive.
    const amp =
      HERO_ECOSYSTEM_MOTION.floatAmplitudeMin +
      ((index * 37) % 10) *
        ((HERO_ECOSYSTEM_MOTION.floatAmplitudeMax - HERO_ECOSYSTEM_MOTION.floatAmplitudeMin) / 10);
    const durX = 3600 + index * 290;
    const durY = 4300 + index * 210;
    const phase = index * 170;
    // Prefer horizontal/vertical split so net radial error stays tiny (±2–3px).
    const ax = amp * 0.55;
    const ay = amp * 0.55;

    icon.floatX.value = withDelay(
      HERO_ECOSYSTEM_TIMINGS.floatStart + phase,
      withRepeat(
        withSequence(
          withTiming(ax, { duration: durX, easing: HERO_ECOSYSTEM_EASING.softInOut }),
          withTiming(-ax, { duration: durX, easing: HERO_ECOSYSTEM_EASING.softInOut }),
        ),
        -1,
        true,
      ),
    );

    icon.floatY.value = withDelay(
      HERO_ECOSYSTEM_TIMINGS.floatStart + phase + 110,
      withRepeat(
        withSequence(
          withTiming(-ay, { duration: durY, easing: HERO_ECOSYSTEM_EASING.softInOut }),
          withTiming(ay, { duration: durY, easing: HERO_ECOSYSTEM_EASING.softInOut }),
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
      const delay = getHeroIconEnterDelay(index);
      icon.opacity.value = delayedTiming(1, delay, HERO_ECOSYSTEM_TIMINGS.icons.duration);
      icon.scale.value = delayedTiming(1, delay, HERO_ECOSYSTEM_TIMINGS.icons.duration);
      icon.enterX.value = delayedTiming(0, delay, HERO_ECOSYSTEM_TIMINGS.icons.duration);
      icon.enterY.value = delayedTiming(0, delay, HERO_ECOSYSTEM_TIMINGS.icons.duration);

      icon.connection.value = withDelay(
        getHeroConnectionDelay(index),
        withTiming(1, {
          duration: HERO_ECOSYSTEM_TIMINGS.connections.duration,
          easing: Easing.out(Easing.cubic),
        }),
      );

      startFloat(icon, index);
    });

    focusOpacity.value = delayedTiming(
      HERO_ECOSYSTEM_MOTION.dimOpacity,
      HERO_ECOSYSTEM_TIMINGS.focus.delay,
      HERO_ECOSYSTEM_TIMINGS.focus.duration,
      HERO_ECOSYSTEM_EASING.softInOut,
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
