/**
 * #535 End of Playback Action — what happens when a video plays to its end. Pure, so every case is unit-tested; the
 * Player screen runs it on the player's `playToEnd` (`src/screens/player/page/use-repeat.ts`).
 *
 * Before P5 there was no choice: the video stopped on its last frame with a Replay button. That stays the default
 * ("Stop"). P5 adds two choices: Repeat one (#539) and Repeat all (#540). An A-B loop (#541) comes before all of them.
 * P6 adds Auto Play Next (#534, off by default) between Repeat all and the End of Playback Action, and the Next
 * Episode Prompt's Cancel (#733).
 */

import type { AbLoop } from './ab-repeat';

export const END_OF_PLAYBACK_ACTIONS = ['stop', 'repeatOne', 'repeatAll'] as const;

export type EndOfPlaybackAction = (typeof END_OF_PLAYBACK_ACTIONS)[number];

/** Today's behaviour, unchanged: stop at the end and show Replay. */
export const DEFAULT_END_OF_PLAYBACK_ACTION: EndOfPlaybackAction = 'stop';

export function normalizeEndOfPlaybackAction(value: unknown): EndOfPlaybackAction {
  return typeof value === 'string' && (END_OF_PLAYBACK_ACTIONS as readonly string[]).includes(value)
    ? (value as EndOfPlaybackAction)
    : DEFAULT_END_OF_PLAYBACK_ACTION;
}

export type EndOfPlaybackInput = {
  /** The A-B loop that is on, if any. */
  loop: AbLoop | null;
  /** The End of Playback Action chosen (Stop, Repeat one, Repeat all). */
  action: EndOfPlaybackAction;
  /** The play queue in play order (`play-queue.ts` `ids`), and the video that just ended. */
  queue: readonly string[];
  mediaId: string | null;
  /** P6 #534: Auto Play Next is on (off by default). */
  autoPlayNext?: boolean;
  /** P6 #534: the next video in this one's folder, for Auto Play Next when the video has no queue. */
  folderNextId?: string | null;
  /** P6 #733: the user cancelled the "Next: …" card for this video: it ends without moving on. */
  advanceCancelled?: boolean;
  /** Faran's P18 #644: the sleep timer is set to "End of this video": it stops, before any loop or repeat. */
  sleepAtEnd?: boolean;
};

export type EndOfPlaybackOutcome =
  /** #541: back to A, playing. */
  | { kind: 'loop'; seekSeconds: number }
  /** #539 (or #540 with a list of one): the same video again from the start. */
  | { kind: 'replay'; reason: 'repeatOne' | 'repeatAll' }
  /**
   * #540: the next video of the queue, after the last one the first. #534 (P6): the next of the queue (no wrap), or of
   * the folder when there is no queue.
   */
  | { kind: 'next'; mediaId: string; reason: 'repeatAll' | 'autoPlayNext' | 'folder' }
  /** Today's end: stopped, with Replay. */
  | { kind: 'stop' };

/**
 * The one place that decides what a finished video does, in this order:
 * 1. an A-B loop that is on → back to A;
 * 2. Repeat one → the same video again;
 * 3. Repeat all → the next one of the queue, the first after the last (a video without a queue repeats itself);
 * 4. Auto Play Next (P6) → the next one of the queue, without wrapping; with no queue, the next in its folder;
 * 5. otherwise → the End of Playback Action's Stop, as before P5.
 * A "next" the user cancelled on the Next Episode card (P6) stops instead. The sleep timer's "End of this video"
 * (Faran's P18) stops first of all.
 */
/**
 * Whether expo-video's `playToEnd` is the end of the video that plays (P6 fix, found on the emulator 2026-11-24).
 *
 * Each session's player starts empty (`useVideoPlayer(null)`) and prepares an empty playlist, which ExoPlayer reports
 * as ended, so expo-video sends `playToEnd` before the video is loaded. Acting on that one moved a video that had just
 * opened on to the next (Auto Play Next, Repeat all; then that one too, and so on) or restarted it (Repeat one): the
 * "Up next restarts the same video" bug. A real end comes from a loaded video: the session is ready, with no error,
 * and the player knows the video's length.
 */
export function isRealPlayToEnd(input: { isReady: boolean; hasError: boolean; playerDurationSeconds: number }): boolean {
  return (
    input.isReady && !input.hasError && Number.isFinite(input.playerDurationSeconds) && input.playerDurationSeconds > 0
  );
}

/** The player's length in seconds (0 when it has none, or is released). */
export function readPlayerDuration(player: { duration: number }): number {
  try {
    const duration = player.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch {
    return 0;
  }
}

export function decideEndOfPlayback(input: EndOfPlaybackInput): EndOfPlaybackOutcome {
  if (input.sleepAtEnd) {
    return { kind: 'stop' };
  }
  const outcome = decideBeforeCancel(input);
  return outcome.kind === 'next' && input.advanceCancelled ? { kind: 'stop' } : outcome;
}

function decideBeforeCancel(input: EndOfPlaybackInput): EndOfPlaybackOutcome {
  if (input.loop) {
    return { kind: 'loop', seekSeconds: input.loop.startSeconds };
  }
  if (input.action === 'repeatOne') {
    return { kind: 'replay', reason: 'repeatOne' };
  }
  if (input.action === 'repeatAll') {
    const next = repeatAllNext(input.queue, input.mediaId);
    return next && next !== input.mediaId
      ? { kind: 'next', mediaId: next, reason: 'repeatAll' }
      : { kind: 'replay', reason: 'repeatAll' };
  }
  if (input.autoPlayNext) {
    // A "queue" of this video alone is no queue: the folder decides.
    const index = input.mediaId && input.queue.length > 1 ? input.queue.indexOf(input.mediaId) : -1;
    if (index >= 0) {
      const next = input.queue[index + 1];
      return next ? { kind: 'next', mediaId: next, reason: 'autoPlayNext' } : { kind: 'stop' };
    }
    if (input.folderNextId && input.folderNextId !== input.mediaId) {
      return { kind: 'next', mediaId: input.folderNextId, reason: 'folder' };
    }
  }
  return { kind: 'stop' };
}

/** The video after this one in the queue, wrapping round to the first; null when the video isn't in a queue. */
export function repeatAllNext(queue: readonly string[], mediaId: string | null): string | null {
  const index = mediaId ? queue.indexOf(mediaId) : -1;
  if (index < 0) {
    return null;
  }
  return queue[(index + 1) % queue.length] ?? null;
}
