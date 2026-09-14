import { Easing } from 'react-native-reanimated';

/** Choreography clock for Onboarding Screen 2 — calm, sequential, premium. */
export const TRUST_TIMINGS = {
  background: { delay: 0, duration: 420 },
  ambientBreathStart: 600,
  url: { delay: 280, duration: 620 },
  detect: { delay: 980, duration: 560 },
  checkPulse: { delay: 1180, duration: 720 },
  card: { delay: 1580, duration: 580 },
  progressStart: 2100,
  progressSteps: [
    { value: 0.22, duration: 520 },
    { value: 0.48, duration: 700 },
    { value: 0.74, duration: 780 },
    { value: 0.96, duration: 760 },
    { value: 1, duration: 480 },
  ] as const,
  chips: {
    start: 2360,
    stagger: 340,
    duration: 520,
  },
  complete: { delay: 5340, duration: 520 },
  library: { delay: 5520, duration: 680 },
  cardDescend: { delay: 5520, duration: 720 },
  copy: { delay: 1080, duration: 560 },
  footer: { delay: 1680, duration: 480 },
  cardBreathStart: 2300,
} as const;

export const TRUST_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
} as const;

export const TRUST_MOTION = {
  urlTranslateFrom: 14,
  urlScaleFrom: 0.94,
  cardScaleFrom: 0.97,
  cardBreathMin: 1,
  cardBreathMax: 1.012,
  cardBreathMs: 4200,
  cardDescendY: 86,
  chipFloatAmplitude: 2.4,
  chipFloatMs: 3800,
  ambientMin: 0.72,
  ambientMax: 1,
  ambientMs: 5200,
  checkPulseMax: 1.18,
} as const;

/** Instant final frame when Reduce Motion is enabled. */
export const TRUST_REDUCED = {
  progress: 1,
  cardDescendY: 86,
} as const;
