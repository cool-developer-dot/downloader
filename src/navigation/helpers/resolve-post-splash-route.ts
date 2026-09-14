import { routePaths, type RoutePath } from '../constants/route-paths';

/**
 * Destination after Splash 1 (branded splash) finishes.
 *
 * Startup cinematic pages (Gateway → Trust → Library) are launch-local splash
 * surfaces — NOT a one-time onboarding gate. Every cold process start:
 *
 *   Splash 1 → Splash 2–4 (onboarding route) → Home
 *
 * Persisted `onboardingComplete` must not skip this sequence.
 * Warm AppState resume does not re-enter here (process stays on current route).
 */
export function resolvePostSplashRoute(
  _params?: { onboardingComplete?: boolean },
): RoutePath {
  return routePaths.onboarding;
}
