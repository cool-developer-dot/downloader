import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAnimation,
  type SharedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { LIBRARY_CARDS, LIBRARY_FEATURES } from '../constants';

import { LIBRARY_EASING, LIBRARY_MOTION, LIBRARY_TIMINGS } from './timings';

export type LibraryCardAnim = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  enterY: SharedValue<number>;
  floatY: SharedValue<number>;
};

export type LibraryChipAnim = {
  opacity: SharedValue<number>;
  scale: SharedValue<number>;
  translateY: SharedValue<number>;
  floatY: SharedValue<number>;
};

export type LibrarySequenceValues = {
  backgroundOpacity: SharedValue<number>;
  ambientGlow: SharedValue<number>;
  /** 0 scattered → 1 organized grid */
  organize: SharedValue<number>;
  /** 0 grid → 1 dashboard converge */
  converge: SharedValue<number>;
  cards: LibraryCardAnim[];
  chips: LibraryChipAnim[];
  searchOpacity: SharedValue<number>;
  searchScale: SharedValue<number>;
  typedLength: SharedValue<number>;
  filterProgress: SharedValue<number>;
  playProgress: SharedValue<number>;
  playingOpacity: SharedValue<number>;
  playPulse: SharedValue<number>;
  waveform: SharedValue<number>;
  copyOpacity: SharedValue<number>;
  copyTranslateY: SharedValue<number>;
  footerOpacity: SharedValue<number>;
  exitOpacity: SharedValue<number>;
  exitScale: SharedValue<number>;
  exitTranslateY: SharedValue<number>;
  playExit: (onFinished: () => void) => void;
};

type Options = {
  enabled?: boolean;
  reducedMotion?: boolean;
};

function delayedTiming(
  toValue: number,
  delay: number,
  duration: number,
  easing = LIBRARY_EASING.softOut,
) {
  'worklet';
  return withDelay(delay, withTiming(toValue, { duration, easing }));
}

/**
 * Media-library choreography — scatter → organize → search → play → hub.
 * Opacity / scale / translate only for 60 FPS on low-RAM Android.
 */
export function useLibrarySequence({
  enabled = true,
  reducedMotion = false,
}: Options = {}): LibrarySequenceValues {
  const backgroundOpacity = useSharedValue(0);
  const ambientGlow = useSharedValue<number>(LIBRARY_MOTION.ambientMin);
  const organize = useSharedValue(0);
  const converge = useSharedValue(0);

  const c0o = useSharedValue(0);
  const c1o = useSharedValue(0);
  const c2o = useSharedValue(0);
  const c3o = useSharedValue(0);
  const c0s = useSharedValue<number>(LIBRARY_MOTION.cardEnterScale);
  const c1s = useSharedValue<number>(LIBRARY_MOTION.cardEnterScale);
  const c2s = useSharedValue<number>(LIBRARY_MOTION.cardEnterScale);
  const c3s = useSharedValue<number>(LIBRARY_MOTION.cardEnterScale);
  const c0e = useSharedValue<number>(LIBRARY_MOTION.cardEnterY);
  const c1e = useSharedValue<number>(LIBRARY_MOTION.cardEnterY);
  const c2e = useSharedValue<number>(LIBRARY_MOTION.cardEnterY);
  const c3e = useSharedValue<number>(LIBRARY_MOTION.cardEnterY);
  const c0f = useSharedValue(0);
  const c1f = useSharedValue(0);
  const c2f = useSharedValue(0);
  const c3f = useSharedValue(0);

  const cards = useMemo<LibraryCardAnim[]>(
    () => [
      { opacity: c0o, scale: c0s, enterY: c0e, floatY: c0f },
      { opacity: c1o, scale: c1s, enterY: c1e, floatY: c1f },
      { opacity: c2o, scale: c2s, enterY: c2e, floatY: c2f },
      { opacity: c3o, scale: c3s, enterY: c3e, floatY: c3f },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const k0o = useSharedValue(0);
  const k1o = useSharedValue(0);
  const k2o = useSharedValue(0);
  const k3o = useSharedValue(0);
  const k4o = useSharedValue(0);
  const k5o = useSharedValue(0);
  const k0s = useSharedValue(0.92);
  const k1s = useSharedValue(0.92);
  const k2s = useSharedValue(0.92);
  const k3s = useSharedValue(0.92);
  const k4s = useSharedValue(0.92);
  const k5s = useSharedValue(0.92);
  const k0t = useSharedValue(8);
  const k1t = useSharedValue(8);
  const k2t = useSharedValue(8);
  const k3t = useSharedValue(8);
  const k4t = useSharedValue(8);
  const k5t = useSharedValue(8);
  const k0f = useSharedValue(0);
  const k1f = useSharedValue(0);
  const k2f = useSharedValue(0);
  const k3f = useSharedValue(0);
  const k4f = useSharedValue(0);
  const k5f = useSharedValue(0);

  const chips = useMemo<LibraryChipAnim[]>(
    () => [
      { opacity: k0o, scale: k0s, translateY: k0t, floatY: k0f },
      { opacity: k1o, scale: k1s, translateY: k1t, floatY: k1f },
      { opacity: k2o, scale: k2s, translateY: k2t, floatY: k2f },
      { opacity: k3o, scale: k3s, translateY: k3t, floatY: k3f },
      { opacity: k4o, scale: k4s, translateY: k4t, floatY: k4f },
      { opacity: k5o, scale: k5s, translateY: k5t, floatY: k5f },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const searchOpacity = useSharedValue(0);
  const searchScale = useSharedValue(0.96);
  const typedLength = useSharedValue(0);
  const filterProgress = useSharedValue(0);
  const playProgress = useSharedValue(0);
  const playingOpacity = useSharedValue(0);
  const playPulse = useSharedValue(1);
  const waveform = useSharedValue<number>(LIBRARY_MOTION.waveformMin);

  const copyOpacity = useSharedValue(0);
  const copyTranslateY = useSharedValue(10);
  const footerOpacity = useSharedValue(0);

  const exitOpacity = useSharedValue(1);
  const exitScale = useSharedValue(1);
  const exitTranslateY = useSharedValue(0);

  const [exitRequested, setExitRequested] = useState(false);
  const exitFinishedRef = useRef<(() => void) | null>(null);

  const playExit = useCallback((onFinished: () => void) => {
    exitFinishedRef.current = onFinished;
    setExitRequested(true);
  }, []);

  const startCardFloat = useCallback((card: LibraryCardAnim, index: number) => {
    const amp = LIBRARY_MOTION.floatAmplitude * (index % 2 === 0 ? 1 : 0.8);
    const duration = LIBRARY_MOTION.floatMs + index * 260;
    const phase = index * 160;

    card.floatY.value = withDelay(
      LIBRARY_TIMINGS.floatStart + phase,
      withRepeat(
        withSequence(
          withTiming(-amp, { duration, easing: LIBRARY_EASING.softInOut }),
          withTiming(amp, { duration, easing: LIBRARY_EASING.softInOut }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  const startChipFloat = useCallback((chip: LibraryChipAnim, index: number) => {
    const amp = LIBRARY_MOTION.chipFloatAmplitude * (index % 2 === 0 ? 1 : 0.85);
    const duration = LIBRARY_MOTION.chipFloatMs + index * 200;
    const phase = index * 130;

    chip.floatY.value = withDelay(
      LIBRARY_TIMINGS.chips.start + LIBRARY_TIMINGS.chips.stagger * index + phase,
      withRepeat(
        withSequence(
          withTiming(-amp, { duration, easing: LIBRARY_EASING.softInOut }),
          withTiming(amp, { duration, easing: LIBRARY_EASING.softInOut }),
        ),
        -1,
        true,
      ),
    );
  }, []);

  useEffect(() => {
    if (!exitRequested) {
      return;
    }

    const exitMs = reducedMotion
      ? LIBRARY_TIMINGS.exitReduced.duration
      : LIBRARY_TIMINGS.exit.duration;

    exitOpacity.value = withTiming(0, {
      duration: exitMs,
      easing: LIBRARY_EASING.softInOut,
    });
    exitScale.value = withTiming(LIBRARY_MOTION.exitScale, {
      duration: exitMs,
      easing: LIBRARY_EASING.softOut,
    });
    exitTranslateY.value = withTiming(LIBRARY_MOTION.exitTranslateY, {
      duration: exitMs,
      easing: LIBRARY_EASING.softOut,
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

    if (reducedMotion) {
      backgroundOpacity.value = 1;
      ambientGlow.value = 1;
      organize.value = 1;
      converge.value = 1;
      cards.forEach((card) => {
        card.opacity.value = 1;
        card.scale.value = 1;
        card.enterY.value = 0;
        card.floatY.value = 0;
      });
      chips.forEach((chip) => {
        chip.opacity.value = 1;
        chip.scale.value = 1;
        chip.translateY.value = 0;
        chip.floatY.value = 0;
      });
      searchOpacity.value = 1;
      searchScale.value = 1;
      typedLength.value = LIBRARY_TIMINGS.typing.letters;
      filterProgress.value = 1;
      playProgress.value = 1;
      playingOpacity.value = 1;
      playPulse.value = 1;
      waveform.value = 1;
      copyOpacity.value = 1;
      copyTranslateY.value = 0;
      footerOpacity.value = 1;
      return;
    }

    backgroundOpacity.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.background.delay,
      LIBRARY_TIMINGS.background.duration,
    );

    ambientGlow.value = withDelay(
      LIBRARY_TIMINGS.ambientBreathStart,
      withRepeat(
        withSequence(
          withTiming(LIBRARY_MOTION.ambientMax, {
            duration: LIBRARY_MOTION.ambientMs / 2,
            easing: LIBRARY_EASING.softInOut,
          }),
          withTiming(LIBRARY_MOTION.ambientMin, {
            duration: LIBRARY_MOTION.ambientMs / 2,
            easing: LIBRARY_EASING.softInOut,
          }),
        ),
        -1,
        false,
      ),
    );

    // Stage 1 — floating scattered cards
    cards.forEach((card, index) => {
      const delay = LIBRARY_TIMINGS.cards.start + LIBRARY_TIMINGS.cards.stagger * index;
      card.opacity.value = delayedTiming(1, delay, LIBRARY_TIMINGS.cards.duration);
      card.scale.value = delayedTiming(1, delay, LIBRARY_TIMINGS.cards.duration);
      card.enterY.value = delayedTiming(0, delay, LIBRARY_TIMINGS.cards.duration);
      startCardFloat(card, index);
    });

    // Stage 2 — organize into grid
    organize.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.organize.delay,
      LIBRARY_TIMINGS.organize.duration,
      LIBRARY_EASING.softInOut,
    );

    // Stage 3 — feature chips
    chips.forEach((chip, index) => {
      const delay = LIBRARY_TIMINGS.chips.start + LIBRARY_TIMINGS.chips.stagger * index;
      chip.opacity.value = delayedTiming(1, delay, LIBRARY_TIMINGS.chips.duration);
      chip.scale.value = delayedTiming(1, delay, LIBRARY_TIMINGS.chips.duration);
      chip.translateY.value = delayedTiming(0, delay, LIBRARY_TIMINGS.chips.duration);
      startChipFloat(chip, index);
    });

    // Stage 4 — search + typing + filter
    searchOpacity.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.search.delay,
      LIBRARY_TIMINGS.search.duration,
    );
    searchScale.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.search.delay,
      LIBRARY_TIMINGS.search.duration,
    );

    const letterTimings = Array.from({ length: LIBRARY_TIMINGS.typing.letters }, (_, i) =>
      withTiming(i + 1, {
        duration: LIBRARY_TIMINGS.typing.letterMs,
        easing: LIBRARY_EASING.softOut,
      }),
    );
    typedLength.value = withDelay(
      LIBRARY_TIMINGS.typing.delay,
      withSequence(
        letterTimings[0],
        letterTimings[1],
        letterTimings[2],
        letterTimings[3],
        letterTimings[4],
      ),
    );

    filterProgress.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.filter.delay,
      LIBRARY_TIMINGS.filter.duration,
      LIBRARY_EASING.softInOut,
    );

    // Stage 5 — play offline
    playProgress.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.play.delay,
      LIBRARY_TIMINGS.play.duration,
    );
    playingOpacity.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.playing.delay,
      LIBRARY_TIMINGS.playing.duration,
    );
    playPulse.value = withDelay(
      LIBRARY_TIMINGS.play.delay,
      withSequence(
        withTiming(LIBRARY_MOTION.playPulseMax, {
          duration: 280,
          easing: LIBRARY_EASING.softOut,
        }),
        withTiming(1, { duration: 360, easing: LIBRARY_EASING.softInOut }),
        withRepeat(
          withSequence(
            withTiming(1.06, { duration: 900, easing: LIBRARY_EASING.softInOut }),
            withTiming(1, { duration: 900, easing: LIBRARY_EASING.softInOut }),
          ),
          -1,
          false,
        ),
      ),
    );
    waveform.value = withDelay(
      LIBRARY_TIMINGS.playing.delay,
      withRepeat(
        withSequence(
          withTiming(LIBRARY_MOTION.waveformMax, {
            duration: 420,
            easing: LIBRARY_EASING.softInOut,
          }),
          withTiming(LIBRARY_MOTION.waveformMin, {
            duration: 420,
            easing: LIBRARY_EASING.softInOut,
          }),
        ),
        -1,
        false,
      ),
    );

    // Stage 6 — converge into hub
    converge.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.converge.delay,
      LIBRARY_TIMINGS.converge.duration,
      LIBRARY_EASING.softInOut,
    );

    copyOpacity.value = delayedTiming(1, LIBRARY_TIMINGS.copy.delay, LIBRARY_TIMINGS.copy.duration);
    copyTranslateY.value = delayedTiming(
      0,
      LIBRARY_TIMINGS.copy.delay,
      LIBRARY_TIMINGS.copy.duration,
    );
    footerOpacity.value = delayedTiming(
      1,
      LIBRARY_TIMINGS.footer.delay,
      LIBRARY_TIMINGS.footer.duration,
    );

    return () => {
      cancelAnimation(backgroundOpacity);
      cancelAnimation(ambientGlow);
      cancelAnimation(organize);
      cancelAnimation(converge);
      cancelAnimation(searchOpacity);
      cancelAnimation(searchScale);
      cancelAnimation(typedLength);
      cancelAnimation(filterProgress);
      cancelAnimation(playProgress);
      cancelAnimation(playingOpacity);
      cancelAnimation(playPulse);
      cancelAnimation(waveform);
      cancelAnimation(copyOpacity);
      cancelAnimation(copyTranslateY);
      cancelAnimation(footerOpacity);
      cancelAnimation(exitOpacity);
      cancelAnimation(exitScale);
      cancelAnimation(exitTranslateY);
      cards.forEach((card) => {
        cancelAnimation(card.opacity);
        cancelAnimation(card.scale);
        cancelAnimation(card.enterY);
        cancelAnimation(card.floatY);
      });
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
    cards,
    chips,
    converge,
    copyOpacity,
    copyTranslateY,
    enabled,
    exitOpacity,
    exitScale,
    exitTranslateY,
    filterProgress,
    footerOpacity,
    organize,
    playProgress,
    playPulse,
    playingOpacity,
    reducedMotion,
    searchOpacity,
    searchScale,
    startCardFloat,
    startChipFloat,
    typedLength,
    waveform,
  ]);

  void LIBRARY_CARDS.length;
  void LIBRARY_FEATURES.length;

  return {
    backgroundOpacity,
    ambientGlow,
    organize,
    converge,
    cards,
    chips,
    searchOpacity,
    searchScale,
    typedLength,
    filterProgress,
    playProgress,
    playingOpacity,
    playPulse,
    waveform,
    copyOpacity,
    copyTranslateY,
    footerOpacity,
    exitOpacity,
    exitScale,
    exitTranslateY,
    playExit,
  };
}
