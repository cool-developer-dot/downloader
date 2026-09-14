import { Easing } from 'react-native-reanimated';

export const GATEWAY_TIMINGS = {
  background: { delay: 0, duration: 420 },
  logo: { delay: 280, duration: 600 },
  copy: { delay: 1200, duration: 560 },
  footer: { delay: 1600, duration: 480 },
  logoBreathStart: 1700,
  logoFocusGlow: { delay: 4000, duration: 580 },
} as const;

export const GATEWAY_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
} as const;

export const GATEWAY_MOTION = {
  logoScaleFrom: 0.92,
  logoScaleTo: 1,
  logoTranslateFrom: -10,
  logoTranslateTo: 0,
  logoBreathMin: 1,
  logoBreathMax: 1.02,
  logoBreathMs: 4500,
} as const;
