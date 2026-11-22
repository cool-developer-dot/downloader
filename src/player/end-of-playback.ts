/**
 * #535 End of Playback Action — what happens when a video plays to its end. Pure, so every case is unit-tested; the
 * Player screen runs it on the player's `playToEnd` (`src/screens/player/page/use-repeat.ts`).
 *
 * Before P5 there was no choice: the video stopped on its last frame with a Replay button. That stays the default
 * ("Stop"). P5 adds two choices: Repeat one (#539) and Repeat all (#540). An A-B loop (#541) comes before all of them.
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
};

export type EndOfPlaybackOutcome =
  /** #541: back to A, playing. */
  | { kind: 'loop'; seekSeconds: number }
  /** #539 (or #540 with a list of one): the same video again from the start. */
  | { kind: 'replay'; reason: 'repeatOne' | 'repeatAll' }
  /** #540: the next video of the queue; after the last one, the first. */
  | { kind: 'next'; mediaId: string; reason: 'repeatAll' }
  /** Today's end: stopped, with Replay. */
  | { kind: 'stop' };

/**
 * The one place that decides what a finished video does, in this order:
 * 1. an A-B loop that is on → back to A;
 * 2. Repeat one → the same video again;
 * 3. Repeat all → the next one of the queue, the first after the last (a video without a queue repeats itself);
 * 4. otherwise → stop, as before P5.
 */
export function decideEndOfPlayback(input: EndOfPlaybackInput): EndOfPlaybackOutcome {
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
