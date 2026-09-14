import { Easing } from 'react-native-reanimated';

import { SPLASH_BRAND_LETTERS } from '../constants/splash.constants';

/**
 * Cinematic loader timeline (~4.5s total).
 */
export const SPLASH_TIMINGS = {
  logo: { delay: 0, duration: 800 },
  letters: {
    start: 800,
    letterDuration: 220,
    stagger: 65,
  },
  tagline: {
    /** After brand letters settle */
    startOffset: 220,
    wordDuration: 420,
    wordStagger: 110,
  },
  /** Pause after tagline before loader */
  pauseAfterTagline: 280,
  loader: {
    fadeIn: 320,
    fillDuration: 1500,
  },
  holdAtComplete: 250,
  exit: { duration: 750 },
  /** Earliest exit (~ letters + tagline + pause + fill + hold) */
  minVisibleMs: 3600,
} as const;

export const SPLASH_REDUCED_MOTION = {
  minVisibleMs: 800,
  exitDuration: 280,
} as const;

export const SPLASH_EASING = {
  softOut: Easing.out(Easing.cubic),
  softInOut: Easing.inOut(Easing.cubic),
  elegantOut: Easing.bezier(0.16, 1, 0.3, 1),
} as const;

export const SPLASH_MOTION = {
  logoScaleFrom: 0.8,
  logoScaleTo: 1,
  logoExitScale: 0.92,
  letterTranslateFrom: 8,
  letterTranslateTo: 0,
  taglineTranslateFrom: 10,
  taglineScaleFrom: 0.94,
  exitTranslateY: -28,
} as const;

export function getLetterStartDelay(index: number): number {
  return SPLASH_TIMINGS.letters.start + index * SPLASH_TIMINGS.letters.stagger;
}

export function getTaglineStartDelay(): number {
  const lastIndex = SPLASH_BRAND_LETTERS.length - 1;
  return (
    getLetterStartDelay(lastIndex) +
    Math.round(SPLASH_TIMINGS.letters.letterDuration * 0.7) +
    SPLASH_TIMINGS.tagline.startOffset
  );
}

export function getTaglineWordDelay(index: number): number {
  return getTaglineStartDelay() + index * SPLASH_TIMINGS.tagline.wordStagger;
}

export function getLoaderStartDelay(): number {
  const lastWordIndex = 2;
  return (
    getTaglineWordDelay(lastWordIndex) +
    Math.round(SPLASH_TIMINGS.tagline.wordDuration * 0.55) +
    SPLASH_TIMINGS.pauseAfterTagline
  );
}

export const SPLASH_LETTER_COUNT = SPLASH_BRAND_LETTERS.length;
