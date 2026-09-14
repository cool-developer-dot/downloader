import { useCallback, useEffect, useMemo } from 'react';
import {
  cancelAnimation,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { TRUST_CAPABILITIES } from '../constants';

import { TRUST_EASING, TRUST_MOTION, TRUST_REDUCED, TRUST_TIMINGS } from './timings';

export type TrustChipAnim = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  translateY: SharedValue<number>;
  floatY: SharedValue<number>;
};

export type TrustSequenceValues = {
  backgroundOpacity: SharedValue<number>;
  ambientGlow: SharedValue<number>;
  urlOpacity: SharedValue<number>;
  urlScale: SharedValue<number>;
  urlTranslateY: SharedValue<number>;
  urlLabelOpacity: SharedValue<number>;
  detectedOpacity: SharedValue<number>;
  checkOpacity: SharedValue<number>;
  checkScale: SharedValue<number>;
  checkGlow: SharedValue<number>;
  cardOpacity: SharedValue<number>;
  cardScale: SharedValue<number>;
  cardBreath: SharedValue<number>;
  cardTranslateY: SharedValue<number>;
  progress: SharedValue<number>;
  progressOpacity: SharedValue<number>;
  completedOpacity: SharedValue<number>;
  libraryOpacity: SharedValue<number>;
  libraryGlow: SharedValue<number>;
  chips: TrustChipAnim[];
  copyOpacity: SharedValue<number>;
  copyTranslateY: SharedValue<number>;
  footerOpacity: SharedValue<number>;
};

type Options = {
  enabled?: boolean;
  reducedMotion?: boolean;
};

function delayedTiming(
  toValue: number,
  delay: number,
  duration: number,
  easing = TRUST_EASING.softOut,
) {
  'worklet';
  return withDelay(delay, withTiming(toValue, { duration, easing }));
}

function buildProgressSequence() {
  'worklet';
  const steps = TRUST_TIMINGS.progressSteps.map((step) =>
    withTiming(step.value, {
      duration: step.duration,
      easing: TRUST_EASING.softInOut,
    }),
  );
  return withDelay(
    TRUST_TIMINGS.progressStart,
    withSequence(steps[0], steps[1], steps[2], steps[3], steps[4]),
  );
}

/**
 * Living download-workflow choreography.
 * Opacity / scale / translate only — GPU-friendly for low-RAM Android.
 */
export function useTrustSequence({
  enabled = true,
  reducedMotion = false,
}: Options = {}): TrustSequenceValues {
  const backgroundOpacity = useSharedValue(0);
  const ambientGlow = useSharedValue<number>(TRUST_MOTION.ambientMin);

  const urlOpacity = useSharedValue(0);
  const urlScale = useSharedValue<number>(TRUST_MOTION.urlScaleFrom);
  const urlTranslateY = useSharedValue<number>(TRUST_MOTION.urlTranslateFrom);
  const urlLabelOpacity = useSharedValue(1);
  const detectedOpacity = useSharedValue(0);
  const checkOpacity = useSharedValue(0);
  const checkScale = useSharedValue(0.7);
  const checkGlow = useSharedValue(0);

  const cardOpacity = useSharedValue(0);
  const cardScale = useSharedValue<number>(TRUST_MOTION.cardScaleFrom);
  const cardBreath = useSharedValue(1);
  const cardTranslateY = useSharedValue(0);

  const progress = useSharedValue(0);
  const progressOpacity = useSharedValue(1);
  const completedOpacity = useSharedValue(0);

  const libraryOpacity = useSharedValue(0.35);
  const libraryGlow = useSharedValue(0);

  const chipO0 = useSharedValue(0);
  const chipO1 = useSharedValue(0);
  const chipO2 = useSharedValue(0);
  const chipO3 = useSharedValue(0);
  const chipO4 = useSharedValue(0);
  const chipO5 = useSharedValue(0);

  const chipS0 = useSharedValue(0.92);
  const chipS1 = useSharedValue(0.92);
  const chipS2 = useSharedValue(0.92);
  const chipS3 = useSharedValue(0.92);
  const chipS4 = useSharedValue(0.92);
  const chipS5 = useSharedValue(0.92);

  const chipTy0 = useSharedValue(8);
  const chipTy1 = useSharedValue(8);
  const chipTy2 = useSharedValue(8);
  const chipTy3 = useSharedValue(8);
  const chipTy4 = useSharedValue(8);
  const chipTy5 = useSharedValue(8);

  const chipFy0 = useSharedValue(0);
  const chipFy1 = useSharedValue(0);
  const chipFy2 = useSharedValue(0);
  const chipFy3 = useSharedValue(0);
  const chipFy4 = useSharedValue(0);
  const chipFy5 = useSharedValue(0);

  const chips = useMemo<TrustChipAnim[]>(
    () => [
      { opacity: chipO0, scale: chipS0, translateY: chipTy0, floatY: chipFy0 },
      { opacity: chipO1, scale: chipS1, translateY: chipTy1, floatY: chipFy1 },
      { opacity: chipO2, scale: chipS2, translateY: chipTy2, floatY: chipFy2 },
      { opacity: chipO3, scale: chipS3, translateY: chipTy3, floatY: chipFy3 },
      { opacity: chipO4, scale: chipS4, translateY: chipTy4, floatY: chipFy4 },
      { opacity: chipO5, scale: chipS5, translateY: chipTy5, floatY: chipFy5 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const copyOpacity = useSharedValue(0);
  const copyTranslateY = useSharedValue(10);
  const footerOpacity = useSharedValue(0);

  const startChipFloat = useCallback((chip: TrustChipAnim, index: number) => {
    const amp = TRUST_MOTION.chipFloatAmplitude * (index % 2 === 0 ? 1 : 0.85);
    const duration = TRUST_MOTION.chipFloatMs + index * 220;
    const phase = index * 140;

    chip.floatY.value = withDelay(
      TRUST_TIMINGS.chips.start + TRUST_TIMINGS.chips.stagger * index + 200 + phase,
      withRepeat(
        withSequence(
          withTiming(-amp, { duration, easing: TRUST_EASING.softInOut }),
          withTiming(amp, { duration, easing: TRUST_EASING.softInOut }),
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

    if (reducedMotion) {
      backgroundOpacity.value = 1;
      ambientGlow.value = 1;
      urlOpacity.value = 1;
      urlScale.value = 1;
      urlTranslateY.value = 0;
      urlLabelOpacity.value = 0;
      detectedOpacity.value = 1;
      checkOpacity.value = 1;
      checkScale.value = 1;
      checkGlow.value = 0.6;
      cardOpacity.value = 1;
      cardScale.value = 1;
      cardBreath.value = 1;
      cardTranslateY.value = TRUST_REDUCED.cardDescendY;
      progress.value = TRUST_REDUCED.progress;
      progressOpacity.value = 0;
      completedOpacity.value = 1;
      libraryOpacity.value = 1;
      libraryGlow.value = 1;
      chips.forEach((chip) => {
        chip.opacity.value = 1;
        chip.scale.value = 1;
        chip.translateY.value = 0;
        chip.floatY.value = 0;
      });
      copyOpacity.value = 1;
      copyTranslateY.value = 0;
      footerOpacity.value = 1;
      return;
    }

    backgroundOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.background.delay,
      TRUST_TIMINGS.background.duration,
    );

    ambientGlow.value = withDelay(
      TRUST_TIMINGS.ambientBreathStart,
      withRepeat(
        withSequence(
          withTiming(TRUST_MOTION.ambientMax, {
            duration: TRUST_MOTION.ambientMs / 2,
            easing: TRUST_EASING.softInOut,
          }),
          withTiming(TRUST_MOTION.ambientMin, {
            duration: TRUST_MOTION.ambientMs / 2,
            easing: TRUST_EASING.softInOut,
          }),
        ),
        -1,
        false,
      ),
    );

    // Stage 1 — URL chip
    urlOpacity.value = delayedTiming(1, TRUST_TIMINGS.url.delay, TRUST_TIMINGS.url.duration);
    urlScale.value = delayedTiming(1, TRUST_TIMINGS.url.delay, TRUST_TIMINGS.url.duration);
    urlTranslateY.value = delayedTiming(0, TRUST_TIMINGS.url.delay, TRUST_TIMINGS.url.duration);

    // Stage 2 — morph to Video Detected
    urlLabelOpacity.value = delayedTiming(
      0,
      TRUST_TIMINGS.detect.delay,
      TRUST_TIMINGS.detect.duration,
      TRUST_EASING.softInOut,
    );
    detectedOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.detect.delay,
      TRUST_TIMINGS.detect.duration,
    );
    checkOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.detect.delay + 40,
      TRUST_TIMINGS.detect.duration,
    );
    checkScale.value = withDelay(
      TRUST_TIMINGS.checkPulse.delay,
      withSequence(
        withTiming(TRUST_MOTION.checkPulseMax, {
          duration: TRUST_TIMINGS.checkPulse.duration * 0.45,
          easing: TRUST_EASING.softOut,
        }),
        withTiming(1, {
          duration: TRUST_TIMINGS.checkPulse.duration * 0.55,
          easing: TRUST_EASING.softInOut,
        }),
      ),
    );
    checkGlow.value = withDelay(
      TRUST_TIMINGS.checkPulse.delay,
      withSequence(
        withTiming(1, {
          duration: TRUST_TIMINGS.checkPulse.duration * 0.4,
          easing: TRUST_EASING.softOut,
        }),
        withTiming(0.35, {
          duration: TRUST_TIMINGS.checkPulse.duration * 0.6,
          easing: TRUST_EASING.softInOut,
        }),
      ),
    );

    // Stage 3 — download card
    cardOpacity.value = delayedTiming(1, TRUST_TIMINGS.card.delay, TRUST_TIMINGS.card.duration);
    cardScale.value = delayedTiming(1, TRUST_TIMINGS.card.delay, TRUST_TIMINGS.card.duration);

    cardBreath.value = withDelay(
      TRUST_TIMINGS.cardBreathStart,
      withRepeat(
        withSequence(
          withTiming(TRUST_MOTION.cardBreathMax, {
            duration: TRUST_MOTION.cardBreathMs / 2,
            easing: TRUST_EASING.softInOut,
          }),
          withTiming(TRUST_MOTION.cardBreathMin, {
            duration: TRUST_MOTION.cardBreathMs / 2,
            easing: TRUST_EASING.softInOut,
          }),
        ),
        -1,
        false,
      ),
    );

    // Stage 4 — progress
    progress.value = 0;
    progress.value = buildProgressSequence();

    // Stage 5 — capability chips
    chips.forEach((chip, index) => {
      const delay = TRUST_TIMINGS.chips.start + TRUST_TIMINGS.chips.stagger * index;
      chip.opacity.value = delayedTiming(1, delay, TRUST_TIMINGS.chips.duration);
      chip.scale.value = delayedTiming(1, delay, TRUST_TIMINGS.chips.duration);
      chip.translateY.value = delayedTiming(0, delay, TRUST_TIMINGS.chips.duration);
      startChipFloat(chip, index);
    });

    // Stage 6 — complete + land in Offline Library
    progressOpacity.value = delayedTiming(
      0,
      TRUST_TIMINGS.complete.delay,
      TRUST_TIMINGS.complete.duration,
      TRUST_EASING.softInOut,
    );
    completedOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.complete.delay,
      TRUST_TIMINGS.complete.duration,
    );

    cardTranslateY.value = delayedTiming(
      TRUST_MOTION.cardDescendY,
      TRUST_TIMINGS.cardDescend.delay,
      TRUST_TIMINGS.cardDescend.duration,
      TRUST_EASING.softInOut,
    );

    libraryOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.library.delay,
      TRUST_TIMINGS.library.duration,
    );
    libraryGlow.value = delayedTiming(
      1,
      TRUST_TIMINGS.library.delay,
      TRUST_TIMINGS.library.duration,
    );

    copyOpacity.value = delayedTiming(1, TRUST_TIMINGS.copy.delay, TRUST_TIMINGS.copy.duration);
    copyTranslateY.value = delayedTiming(0, TRUST_TIMINGS.copy.delay, TRUST_TIMINGS.copy.duration);

    footerOpacity.value = delayedTiming(
      1,
      TRUST_TIMINGS.footer.delay,
      TRUST_TIMINGS.footer.duration,
    );

    return () => {
      cancelAnimation(backgroundOpacity);
      cancelAnimation(ambientGlow);
      cancelAnimation(urlOpacity);
      cancelAnimation(urlScale);
      cancelAnimation(urlTranslateY);
      cancelAnimation(urlLabelOpacity);
      cancelAnimation(detectedOpacity);
      cancelAnimation(checkOpacity);
      cancelAnimation(checkScale);
      cancelAnimation(checkGlow);
      cancelAnimation(cardOpacity);
      cancelAnimation(cardScale);
      cancelAnimation(cardBreath);
      cancelAnimation(cardTranslateY);
      cancelAnimation(progress);
      cancelAnimation(progressOpacity);
      cancelAnimation(completedOpacity);
      cancelAnimation(libraryOpacity);
      cancelAnimation(libraryGlow);
      cancelAnimation(copyOpacity);
      cancelAnimation(copyTranslateY);
      cancelAnimation(footerOpacity);
      chips.forEach((chip) => {
        cancelAnimation(chip.opacity);
        cancelAnimation(chip.scale);
        cancelAnimation(chip.translateY);
        cancelAnimation(chip.floatY);
      });
    };
  }, [
    ambientGlow,
    backgroundOpacity,
    cardBreath,
    cardOpacity,
    cardScale,
    cardTranslateY,
    checkGlow,
    checkOpacity,
    checkScale,
    chips,
    completedOpacity,
    copyOpacity,
    copyTranslateY,
    detectedOpacity,
    enabled,
    footerOpacity,
    libraryGlow,
    libraryOpacity,
    progress,
    progressOpacity,
    reducedMotion,
    startChipFloat,
    urlLabelOpacity,
    urlOpacity,
    urlScale,
    urlTranslateY,
  ]);

  // Keep chip count aligned with constants (compile-time sanity).
  void TRUST_CAPABILITIES.length;

  return {
    backgroundOpacity,
    ambientGlow,
    urlOpacity,
    urlScale,
    urlTranslateY,
    urlLabelOpacity,
    detectedOpacity,
    checkOpacity,
    checkScale,
    checkGlow,
    cardOpacity,
    cardScale,
    cardBreath,
    cardTranslateY,
    progress,
    progressOpacity,
    completedOpacity,
    libraryOpacity,
    libraryGlow,
    chips,
    copyOpacity,
    copyTranslateY,
    footerOpacity,
  };
}
