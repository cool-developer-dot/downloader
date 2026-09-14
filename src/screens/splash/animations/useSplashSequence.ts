import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  type SharedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { SPLASH_BRAND_LETTERS } from '../constants/splash.constants';

import {
  getLetterStartDelay,
  getLoaderStartDelay,
  getTaglineWordDelay,
  SPLASH_EASING,
  SPLASH_MOTION,
  SPLASH_REDUCED_MOTION,
  SPLASH_TIMINGS,
} from './timings';

export type SplashSequenceValues = {
  logoOpacity: SharedValue<number>;
  logoScale: SharedValue<number>;
  letterOpacities: SharedValue<number>[];
  letterTranslateYs: SharedValue<number>[];
  taglineWordOpacities: SharedValue<number>[];
  taglineWordTranslateYs: SharedValue<number>[];
  taglineWordScales: SharedValue<number>[];
  loaderOpacity: SharedValue<number>;
  loaderProgress: SharedValue<number>;
  contentOpacity: SharedValue<number>;
  contentScale: SharedValue<number>;
  contentTranslateY: SharedValue<number>;
  playExit: (onFinished: () => void) => void;
};

type UseSplashSequenceOptions = {
  enabled?: boolean;
  reducedMotion?: boolean;
};

/**
 * Cinematic splash choreography — opacity/scale/translate only (60 FPS).
 */
export function useSplashSequence({
  enabled = true,
  reducedMotion = false,
}: UseSplashSequenceOptions): SplashSequenceValues {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue<number>(SPLASH_MOTION.logoScaleFrom);

  const letterOpacity0 = useSharedValue(0);
  const letterOpacity1 = useSharedValue(0);
  const letterOpacity2 = useSharedValue(0);
  const letterOpacity3 = useSharedValue(0);
  const letterOpacity4 = useSharedValue(0);
  const letterOpacity5 = useSharedValue(0);
  const letterOpacity6 = useSharedValue(0);

  const letterTranslate0 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate1 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate2 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate3 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate4 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate5 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);
  const letterTranslate6 = useSharedValue<number>(SPLASH_MOTION.letterTranslateFrom);

  const taglineOpacity0 = useSharedValue(0);
  const taglineOpacity1 = useSharedValue(0);
  const taglineOpacity2 = useSharedValue(0);

  const taglineTranslate0 = useSharedValue<number>(SPLASH_MOTION.taglineTranslateFrom);
  const taglineTranslate1 = useSharedValue<number>(SPLASH_MOTION.taglineTranslateFrom);
  const taglineTranslate2 = useSharedValue<number>(SPLASH_MOTION.taglineTranslateFrom);

  const taglineScale0 = useSharedValue<number>(SPLASH_MOTION.taglineScaleFrom);
  const taglineScale1 = useSharedValue<number>(SPLASH_MOTION.taglineScaleFrom);
  const taglineScale2 = useSharedValue<number>(SPLASH_MOTION.taglineScaleFrom);

  const letterOpacities = useMemo(
    () => [
      letterOpacity0,
      letterOpacity1,
      letterOpacity2,
      letterOpacity3,
      letterOpacity4,
      letterOpacity5,
      letterOpacity6,
    ],
    [
      letterOpacity0,
      letterOpacity1,
      letterOpacity2,
      letterOpacity3,
      letterOpacity4,
      letterOpacity5,
      letterOpacity6,
    ],
  );

  const letterTranslateYs = useMemo(
    () => [
      letterTranslate0,
      letterTranslate1,
      letterTranslate2,
      letterTranslate3,
      letterTranslate4,
      letterTranslate5,
      letterTranslate6,
    ],
    [
      letterTranslate0,
      letterTranslate1,
      letterTranslate2,
      letterTranslate3,
      letterTranslate4,
      letterTranslate5,
      letterTranslate6,
    ],
  );

  const taglineWordOpacities = useMemo(
    () => [taglineOpacity0, taglineOpacity1, taglineOpacity2],
    [taglineOpacity0, taglineOpacity1, taglineOpacity2],
  );

  const taglineWordTranslateYs = useMemo(
    () => [taglineTranslate0, taglineTranslate1, taglineTranslate2],
    [taglineTranslate0, taglineTranslate1, taglineTranslate2],
  );

  const taglineWordScales = useMemo(
    () => [taglineScale0, taglineScale1, taglineScale2],
    [taglineScale0, taglineScale1, taglineScale2],
  );

  const loaderOpacity = useSharedValue(0);
  const loaderProgress = useSharedValue(0);
  const contentOpacity = useSharedValue(1);
  const contentScale = useSharedValue(1);
  const contentTranslateY = useSharedValue(0);

  const [exitRequested, setExitRequested] = useState(false);
  const exitFinishedRef = useRef<(() => void) | null>(null);

  const playExit = useCallback((onFinished: () => void) => {
    exitFinishedRef.current = onFinished;
    setExitRequested(true);
  }, []);

  useEffect(() => {
    if (!exitRequested) {
      return;
    }

    const exitMs = reducedMotion
      ? SPLASH_REDUCED_MOTION.exitDuration
      : SPLASH_TIMINGS.exit.duration;

    contentOpacity.value = withTiming(0, {
      duration: exitMs,
      easing: SPLASH_EASING.softInOut,
    });
    contentScale.value = withTiming(SPLASH_MOTION.logoExitScale, {
      duration: exitMs,
      easing: SPLASH_EASING.elegantOut,
    });
    contentTranslateY.value = withTiming(SPLASH_MOTION.exitTranslateY, {
      duration: exitMs,
      easing: SPLASH_EASING.elegantOut,
    });

    const doneTimer = setTimeout(() => {
      exitFinishedRef.current?.();
    }, exitMs);

    return () => {
      clearTimeout(doneTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exitRequested, reducedMotion]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    cancelAnimation(logoOpacity);
    cancelAnimation(logoScale);
    letterOpacities.forEach(cancelAnimation);
    letterTranslateYs.forEach(cancelAnimation);
    taglineWordOpacities.forEach(cancelAnimation);
    taglineWordTranslateYs.forEach(cancelAnimation);
    taglineWordScales.forEach(cancelAnimation);
    cancelAnimation(loaderOpacity);
    cancelAnimation(loaderProgress);

    logoOpacity.value = 0;
    logoScale.value = SPLASH_MOTION.logoScaleFrom;
    letterOpacities.forEach((sv) => {
      sv.value = 0;
    });
    letterTranslateYs.forEach((sv) => {
      sv.value = SPLASH_MOTION.letterTranslateFrom;
    });
    taglineWordOpacities.forEach((sv) => {
      sv.value = 0;
    });
    taglineWordTranslateYs.forEach((sv) => {
      sv.value = SPLASH_MOTION.taglineTranslateFrom;
    });
    taglineWordScales.forEach((sv) => {
      sv.value = SPLASH_MOTION.taglineScaleFrom;
    });
    loaderOpacity.value = 0;
    loaderProgress.value = 0;

    if (reducedMotion) {
      logoOpacity.value = 1;
      logoScale.value = 1;
      letterOpacities.forEach((sv) => {
        sv.value = 1;
      });
      letterTranslateYs.forEach((sv) => {
        sv.value = 0;
      });
      taglineWordOpacities.forEach((sv) => {
        sv.value = 1;
      });
      taglineWordTranslateYs.forEach((sv) => {
        sv.value = 0;
      });
      taglineWordScales.forEach((sv) => {
        sv.value = 1;
      });
      loaderOpacity.value = 1;
      loaderProgress.value = withTiming(1, {
        duration: 600,
        easing: SPLASH_EASING.softOut,
      });
      return;
    }

    logoOpacity.value = withTiming(1, {
      duration: SPLASH_TIMINGS.logo.duration,
      easing: SPLASH_EASING.elegantOut,
    });
    logoScale.value = withTiming(SPLASH_MOTION.logoScaleTo, {
      duration: SPLASH_TIMINGS.logo.duration,
      easing: SPLASH_EASING.elegantOut,
    });

    const { letterDuration } = SPLASH_TIMINGS.letters;
    SPLASH_BRAND_LETTERS.forEach((_, index) => {
      const delay = getLetterStartDelay(index);
      letterOpacities[index].value = withDelay(
        delay,
        withTiming(1, {
          duration: letterDuration,
          easing: SPLASH_EASING.elegantOut,
        }),
      );
      letterTranslateYs[index].value = withDelay(
        delay,
        withTiming(SPLASH_MOTION.letterTranslateTo, {
          duration: letterDuration + 40,
          easing: SPLASH_EASING.elegantOut,
        }),
      );
    });

    // Fast · Reliable · Secure — staggered word pop
    const taglineWords = [
      { opacity: taglineOpacity0, translateY: taglineTranslate0, scale: taglineScale0 },
      { opacity: taglineOpacity1, translateY: taglineTranslate1, scale: taglineScale1 },
      { opacity: taglineOpacity2, translateY: taglineTranslate2, scale: taglineScale2 },
    ];
    taglineWords.forEach((word, index) => {
      const delay = getTaglineWordDelay(index);
      word.opacity.value = withDelay(
        delay,
        withTiming(1, {
          duration: SPLASH_TIMINGS.tagline.wordDuration,
          easing: SPLASH_EASING.elegantOut,
        }),
      );
      word.translateY.value = withDelay(
        delay,
        withTiming(0, {
          duration: SPLASH_TIMINGS.tagline.wordDuration,
          easing: SPLASH_EASING.elegantOut,
        }),
      );
      word.scale.value = withDelay(
        delay,
        withTiming(1, {
          duration: SPLASH_TIMINGS.tagline.wordDuration,
          easing: SPLASH_EASING.elegantOut,
        }),
      );
    });

    const loaderStart = getLoaderStartDelay();
    loaderOpacity.value = withDelay(
      loaderStart,
      withTiming(1, {
        duration: SPLASH_TIMINGS.loader.fadeIn,
        easing: SPLASH_EASING.softOut,
      }),
    );
    loaderProgress.value = withDelay(
      loaderStart,
      withTiming(1, {
        duration: SPLASH_TIMINGS.loader.fillDuration,
        easing: SPLASH_EASING.softInOut,
      }),
    );

    return () => {
      cancelAnimation(logoOpacity);
      cancelAnimation(logoScale);
      letterOpacities.forEach(cancelAnimation);
      letterTranslateYs.forEach(cancelAnimation);
      taglineWordOpacities.forEach(cancelAnimation);
      taglineWordTranslateYs.forEach(cancelAnimation);
      taglineWordScales.forEach(cancelAnimation);
      cancelAnimation(loaderOpacity);
      cancelAnimation(loaderProgress);
    };
  }, [
    enabled,
    letterOpacities,
    letterTranslateYs,
    loaderOpacity,
    loaderProgress,
    logoOpacity,
    logoScale,
    reducedMotion,
    taglineWordOpacities,
    taglineWordScales,
    taglineWordTranslateYs,
  ]);

  return {
    logoOpacity,
    logoScale,
    letterOpacities,
    letterTranslateYs,
    taglineWordOpacities,
    taglineWordTranslateYs,
    taglineWordScales,
    loaderOpacity,
    loaderProgress,
    contentOpacity,
    contentScale,
    contentTranslateY,
    playExit,
  };
}
