/**
 * P5 / P6 at the end of a video that plays in the mini player (Faran, after the P6 review: Hamza's open decision 8).
 *
 * The full Player decides what a finished video does (`use-repeat.ts`: Repeat one, Repeat all, Auto Play Next with its
 * folder fallback, the A-B loop and the Next Episode card's Cancel). With no full Player showing the session — the
 * in-app mini player, or the app in the background after leaving the Player — nothing did, and a queue stopped after
 * one video. The session's runner now makes the same decision (`decideEndOfPlayback`) there: Repeat one plays the
 * video again; Repeat all and Auto Play Next open the next video in the same session host, so the mini player and the
 * notification follow it. An A-B loop and the Next Episode card belong to the full Player's screen and end with it.
 *
 * Pure apart from its `deps`, so it is unit tested; `use-session-end-of-playback.ts` wires the real ones.
 */

import { decideEndOfPlayback, type EndOfPlaybackAction, type EndOfPlaybackOutcome } from '../end-of-playback';

export type SessionEndDeps = {
  /** Full Player screens showing the session now (`player-session-store`'s `fullPlayerCount`). */
  fullPlayerCount: () => number;
  endAction: () => EndOfPlaybackAction;
  queue: () => readonly string[];
  autoPlayNext: () => boolean;
  /** The next video of this one's folder (Auto Play Next with no queue), or null. */
  folderNextId: (mediaId: string) => Promise<string | null>;
  /** P18's "End of this video": the sleep timer stops here. */
  sleepAtEnd: () => boolean;
  replay: () => void;
  /** Opens the next video in the session host (the mini player shows it). */
  openNext: (mediaId: string) => void;
};

/** What the runner did at the end of `mediaId`: `skipped` when the full Player decides (or there is nothing to play). */
export type SessionEndResult = EndOfPlaybackOutcome | { kind: 'skipped' };

export async function runSessionEndOfPlayback(mediaId: string | null, deps: SessionEndDeps): Promise<SessionEndResult> {
  if (deps.fullPlayerCount() > 0 || mediaId == null) {
    return { kind: 'skipped' };
  }
  const action = deps.endAction();
  const queue = deps.queue();
  const autoPlayNext = deps.autoPlayNext();
  // The folder is read only when it can decide: Auto Play Next on, and this video not in a queue of several.
  const inQueue = queue.length > 1 && queue.includes(mediaId);
  const folderNextId =
    action === 'stop' && autoPlayNext && !inQueue ? await deps.folderNextId(mediaId).catch(() => null) : null;
  // The full Player may have opened while the folder was read: it decides then.
  if (deps.fullPlayerCount() > 0) {
    return { kind: 'skipped' };
  }
  const outcome = decideEndOfPlayback({
    loop: null,
    action,
    queue,
    mediaId,
    autoPlayNext,
    folderNextId,
    advanceCancelled: false,
    sleepAtEnd: deps.sleepAtEnd(),
  });
  if (outcome.kind === 'replay') {
    deps.replay();
  } else if (outcome.kind === 'next') {
    deps.openNext(outcome.mediaId);
  }
  return outcome;
}

/** A video the runner moved to by itself: it starts even with the app in the background (background play was on). */
let autoAdvancedTo: { mediaId: string; at: number } | null = null;
const AUTO_ADVANCE_WINDOW_MS = 30_000;

export function markSessionAutoAdvance(mediaId: string, now = Date.now()): void {
  autoAdvancedTo = { mediaId, at: now };
}

/** True once for the video the runner moved to (within 30 s); false for any other. */
export function takeSessionAutoAdvance(mediaId: string | null, now = Date.now()): boolean {
  const pending = autoAdvancedTo;
  if (!pending || mediaId == null || pending.mediaId !== mediaId) {
    return false;
  }
  autoAdvancedTo = null;
  return now - pending.at <= AUTO_ADVANCE_WINDOW_MS;
}
