/**
 * Background / foreground playback policy (pure).
 *
 * playing → background → pause, unless the video moves to a picture-in-picture window
 * foreground → retain position, remain paused, no autoplay
 */

export type AppLifecycleState = 'active' | 'background' | 'inactive' | string;

export type AppLifecycleDecision =
  | { action: 'none' }
  | { action: 'background_pause' }
  /**
   * The system is moving the video into a PiP window: keep playing. If no window appears (PiP turned off for the
   * app) the activity stops, and `decideActivityStopped` pauses it then.
   */
  | { action: 'await_picture_in_picture' }
  | { action: 'foreground_no_autoplay' };

export type PictureInPictureState = {
  /** Leaving VidoraX now would open the PiP window (the player armed auto-enter). */
  armed: boolean;
  /** The PiP window is showing. */
  active: boolean;
};

/**
 * Decide what the player session should do on AppState change.
 */
export function decideAppLifecycleAction(input: {
  nextState: AppLifecycleState;
  isPlaying: boolean;
  pictureInPicture?: PictureInPictureState;
}): AppLifecycleDecision {
  const next = input.nextState;
  if (next === 'background' || next === 'inactive') {
    if (input.pictureInPicture?.active) {
      // The PiP window is the app's foreground now: keep playing, same position, same player.
      return { action: 'none' };
    }
    if (input.isPlaying && input.pictureInPicture?.armed) {
      return { action: 'await_picture_in_picture' };
    }
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

/** Whether leaving VidoraX right now should move the video into a PiP window. */
export function shouldArmPictureInPicture(input: {
  supported: boolean;
  isPlaying: boolean;
  isReady: boolean;
  hasError: boolean;
  isSurfaceRevealed: boolean;
}): boolean {
  return (
    input.supported &&
    input.isPlaying &&
    input.isReady &&
    !input.hasError &&
    input.isSurfaceRevealed
  );
}

/**
 * The activity stopped being visible: the PiP window was dismissed, no PiP window opened, or the screen went off. A
 * video nobody can see must not keep playing. (JavaScript timers are paused in the background, so this native signal
 * — not a timeout — decides.)
 */
export function decideActivityStopped(input: { isPlaying: boolean }): 'pause' | 'none' {
  return input.isPlaying ? 'pause' : 'none';
}

export function shouldTreatAsBackground(
  state: AppLifecycleState,
): boolean {
  return state === 'background' || state === 'inactive';
}
