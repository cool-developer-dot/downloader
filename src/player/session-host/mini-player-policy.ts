/**
 * When the one player session is shown as the in-app mini player, and what its controls do. Pure (no React / native)
 * so the rules are unit-tested; the session host and the mini player read them.
 */

import type { PlayerErrorCode } from '../types';

/** What the host knows about the session it runs. */
export type SessionSnapshot = {
  /** The media the session was opened for (null: a Player route without a usable id). */
  mediaId: string | null;
  error: PlayerErrorCode | null;
  isCompleted: boolean;
  isPlaying: boolean;
  isReady: boolean;
};

export type MiniPlayerVisibilityInput = {
  /** The session's live state, or null when no session runs (closed, or not published yet). */
  session: SessionSnapshot | null;
  /** Full Player screens currently showing the session (the full Player owns the picture while it is up). */
  fullPlayerCount: number;
  /** The session is in the system picture-in-picture window. */
  pictureInPictureActive: boolean;
};

/**
 * The mini player shows only for a playable session the user has left: never next to the full Player, never while the
 * system PiP window shows it, never for a session that failed (missing file, unsupported media, bad route).
 */
export function shouldShowMiniPlayer(input: MiniPlayerVisibilityInput): boolean {
  const { session } = input;
  if (session == null || session.mediaId == null || session.error != null) {
    return false;
  }
  return input.fullPlayerCount === 0 && !input.pictureInPictureActive;
}

/**
 * Opening the Player for a media reuses the running session when it is the same media and still healthy (tapping the
 * mini player, or the same video again from the library: no restart, same position); anything else starts a new one.
 */
export function shouldReuseSession(
  running: { mediaId: string | null; error: PlayerErrorCode | null } | null,
  mediaId: string | null,
): boolean {
  return running != null && mediaId != null && running.mediaId === mediaId && running.error == null;
}

/** A session that failed after the user left the full Player has nothing left to show: the host closes it. */
export function shouldCloseFailedSession(input: MiniPlayerVisibilityInput): boolean {
  return input.session?.error != null && input.fullPlayerCount === 0;
}

export type MiniPlayerPrimaryAction = 'play' | 'pause' | 'replay' | 'none';

/** The mini player's one transport button: pause while playing, replay once finished, play otherwise (when loaded). */
export function miniPlayerPrimaryAction(session: SessionSnapshot): MiniPlayerPrimaryAction {
  if (session.error != null || !session.isReady) {
    return 'none';
  }
  if (session.isPlaying) {
    return 'pause';
  }
  return session.isCompleted ? 'replay' : 'play';
}

/** A horizontal fling or a drag past this share of the card's width dismisses it (closes the session). */
export const MINI_PLAYER_DISMISS_FRACTION = 0.4;
export const MINI_PLAYER_DISMISS_VELOCITY = 900;

export function shouldDismissOnRelease(translationX: number, velocityX: number, width: number): boolean {
  'worklet';
  if (width <= 0) {
    return false;
  }
  if (Math.abs(translationX) >= width * MINI_PLAYER_DISMISS_FRACTION) {
    return true;
  }
  return Math.abs(velocityX) >= MINI_PLAYER_DISMISS_VELOCITY && Math.sign(velocityX) === Math.sign(translationX);
}
