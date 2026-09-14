import { Easing } from 'react-native-reanimated';

/** Choreography clock for Onboarding Screen 3 — organized media hub. */
export const LIBRARY_TIMINGS = {
  background: { delay: 0, duration: 420 },
  ambientBreathStart: 500,
  cards: {
    start: 240,
    stagger: 180,
    duration: 620,
  },
  floatStart: 900,
  organize: { delay: 1680, duration: 1100 },
  chips: {
    start: 2900,
    stagger: 160,
    duration: 480,
  },
  search: { delay: 3900, duration: 520 },
  typing: {
    delay: 4480,
    letterMs: 110,
    letters: 5,
  },
  filter: { delay: 5100, duration: 480 },
  play: { delay: 5680, duration: 560 },
  playing: { delay: 6200, duration: 520 },
  converge: { delay: 7000, duration: 900 },
  copy: { delay: 1100, duration: 560 },
  footer: { delay: 1700, duration: 480 },
  exit: { duration: 520 },
  exitReduced: { duration: 220 },
} as const;

export const LIBRARY_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
} as const;

export const LIBRARY_MOTION = {
  cardEnterScale: 0.92,
  cardEnterY: 16,
  floatAmplitude: 3.2,
  floatMs: 4200,
  chipFloatAmplitude: 2.2,
  chipFloatMs: 4000,
  ambientMin: 0.7,
  ambientMax: 1,
  ambientMs: 5400,
  highlightScale: 1.06,
  dimOpacity: 0.28,
  playPulseMax: 1.14,
  exitScale: 0.94,
  exitTranslateY: -18,
  waveformMin: 0.35,
  waveformMax: 1,
} as const;
