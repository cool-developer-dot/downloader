/**
 * Background / foreground playback policy (pure).
 *
 * playing → background/inactive → pause
 * foreground → retain position, remain paused, no autoplay
 */

export type AppLifecycleState = 'active' | 'background' | 'inactive' | string;

export type AppLifecycleDecision =
  | { action: 'none' }
  | { action: 'background_pause' }
  | { action: 'foreground_no_autoplay' };

/**
 * Decide what the player session should do on AppState change.
 */
export function decideAppLifecycleAction(input: {
  nextState: AppLifecycleState;
  isPlaying: boolean;
}): AppLifecycleDecision {
  const next = input.nextState;
  if (next === 'background' || next === 'inactive') {
    if (input.isPlaying) {
      return { action: 'background_pause' };
    }
    return { action: 'none' };
  }
  if (next === 'active') {
    return { action: 'foreground_no_autoplay' };
  }
  return { action: 'none' };
}

export function shouldTreatAsBackground(
  state: AppLifecycleState,
): boolean {
  return state === 'background' || state === 'inactive';
}
