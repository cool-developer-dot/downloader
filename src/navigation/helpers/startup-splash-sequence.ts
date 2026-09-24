/**
 * Cold-start startup splash sequence — launch-local, never persisted.
 *
 * Product surfaces:
 *   Splash 1 — branded SplashScreen
 *   Splash 2 — Gateway
 *   Splash 3 — Trust
 *   Splash 4 — Library (same route; third cinematic page)
 *   → App (Home)
 *
 * Persisted onboardingComplete must not skip Splash 2+.
 */

export type StartupSplashStep =
  | 'splash_1'
  | 'splash_2'
  | 'splash_3'
  | 'splash_4'
  | 'app';

export type ProcessLifecycleEvent = 'process_start' | 'appstate_active' | 'appstate_background';

/** Every cold process start begins at Splash 1. */
export function resolveColdStartSplashStep(): StartupSplashStep {
  return 'splash_1';
}

export function nextStartupSplashStep(step: StartupSplashStep): StartupSplashStep {
  switch (step) {
    case 'splash_1':
      return 'splash_2';
    case 'splash_2':
      return 'splash_3';
    case 'splash_3':
      return 'splash_4';
    case 'splash_4':
      return 'app';
    default:
      return 'app';
  }
}

/**
 * Map cinematic page index (0..N-1) after Splash 1 to splash step.
 * page 0 → splash_2, page 1 → splash_3, page 2 → splash_4.
 */
export function cinematicPageToSplashStep(pageIndex: number): StartupSplashStep {
  if (pageIndex <= 0) {
    return 'splash_2';
  }
  if (pageIndex === 1) {
    return 'splash_3';
  }
  return 'splash_4';
}

/** The cinematic pages are the first-launch introduction; a returning user skips them. */
export function shouldSkipCinematicSplashForPersistedOnboarding(
  onboardingComplete: boolean,
): boolean {
  return onboardingComplete;
}

/** Warm AppState resume must not replay the sequence; process start must. */
export function shouldReplayStartupSplashSequence(
  event: ProcessLifecycleEvent,
): boolean {
  return event === 'process_start';
}

/** Splash sequence index is ephemeral — never write to MMKV/AsyncStorage keys. */
export const STARTUP_SPLASH_PERSISTENCE_FORBIDDEN_KEYS = [
  'currentSplashIndex',
  'splash2Seen',
  'splash3Seen',
  'startupSequenceComplete',
] as const;
