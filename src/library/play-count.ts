/**
 * P9 #708 Play Count: when a play counts. Pure — it reads the Player's existing playback events
 * (`src/player/playback-events.ts`) and says "count one" through `onCount`; storage and React are elsewhere
 * (`ensure-library-stats.ts`).
 *
 * The rules:
 * - **A session** is one video from `playbackStarted` (or its first event) until `playerExited`, or until another video's
 *   events start. The mini player is the same session (it is the same player). Replay and Repeat one don't start a new
 *   one (the Player emits `playbackStarted` once per session), so a looping video counts once.
 * - **Watched time** is the video's own time that actually played: the position moving forward between two events by
 *   at most 3 s (`PLAY_COUNT_MAX_STEP_SECONDS`). Events come about once a second while playing (up to 2× speed: about
 *   2.1 s of video); a seek, forward or back, is a jump and adds nothing. `paused`, `completed` (at the video's end) and
 *   `playerExited` are samples too, so "pause, seek, resume" is a jump.
 * - **It counts once per session**: after 30 s watched, or, for a video shorter than 30 s, when it was watched to the
 *   end (its length minus 1 s, the events' own spacing). Unknown length: the 30 s rule; when it ends, where it ended
 *   is its length.
 * - **Disable History (#687) on: nothing counts**, and time watched meanwhile is not kept for later.
 * - Streams and files opened from another app are not counted (`isCountable`).
 */

import type { PlaybackContractEvent } from '@/player/playback-events';

export const PLAY_COUNT_THRESHOLD_SECONDS = 30;

/** The most the position may move between two events and still be playing (2× speed, 1 s apart, plus slack). */
export const PLAY_COUNT_MAX_STEP_SECONDS = 3;

/** A video shorter than 30 s counts when watched to its end minus this. */
export const SHORT_VIDEO_END_SLACK_SECONDS = 1;

export type PlayCountTrackerOptions = {
  /** Disable History is on. */
  isHistoryPaused: () => boolean;
  /** False for ids that are never counted (streams, files another app opened). */
  isCountable: (mediaId: string) => boolean;
  onCount: (mediaId: string, at: number) => void;
};

export type PlayCountSession = {
  mediaId: string;
  watchedSeconds: number;
  lastPosition: number | null;
  durationSeconds: number | null;
  counted: boolean;
};

export type PlayCountTracker = {
  handle: (event: PlaybackContractEvent) => void;
  /** The session as it is now (a copy; tests and diagnostics). */
  session: () => PlayCountSession | null;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Whether a session has watched enough to count. */
export function playCountReached(session: Pick<PlayCountSession, 'watchedSeconds' | 'durationSeconds'>): boolean {
  const { watchedSeconds, durationSeconds } = session;
  if (!(watchedSeconds > 0)) {
    return false;
  }
  if (finite(durationSeconds) && durationSeconds > 0 && durationSeconds < PLAY_COUNT_THRESHOLD_SECONDS) {
    return watchedSeconds >= Math.max(0, durationSeconds - SHORT_VIDEO_END_SLACK_SECONDS);
  }
  return watchedSeconds >= PLAY_COUNT_THRESHOLD_SECONDS;
}

export function createPlayCountTracker(options: PlayCountTrackerOptions): PlayCountTracker {
  let current: PlayCountSession | null = null;

  const begin = (mediaId: string, startPosition: number | null): PlayCountSession | null => {
    current = options.isCountable(mediaId)
      ? { mediaId, watchedSeconds: 0, lastPosition: startPosition, durationSeconds: null, counted: false }
      : null;
    return current;
  };

  /** The session for this event's video: the running one, or a new one when another video's events start. */
  const sessionFor = (mediaId: string): PlayCountSession | null => {
    if (current?.mediaId === mediaId) {
      return current;
    }
    return begin(mediaId, null);
  };

  /**
   * Pause, end and exit only belong to the running session: one arriving late from the video before (the Player
   * switching videos) never replaces the new video's session.
   */
  const runningSession = (mediaId: string): PlayCountSession | null =>
    current?.mediaId === mediaId ? current : null;

  const sample = (session: PlayCountSession, position: number | null | undefined) => {
    if (!finite(position) || position < 0) {
      return;
    }
    const last = session.lastPosition;
    session.lastPosition = position;
    if (last == null || options.isHistoryPaused()) {
      return;
    }
    const step = position - last;
    if (step > 0 && step <= PLAY_COUNT_MAX_STEP_SECONDS) {
      session.watchedSeconds += step;
    }
  };

  const maybeCount = (session: PlayCountSession, at: number) => {
    if (session.counted || options.isHistoryPaused() || !playCountReached(session)) {
      return;
    }
    session.counted = true;
    options.onCount(session.mediaId, at);
  };

  const handle = (event: PlaybackContractEvent) => {
    if (!event.mediaId) {
      return;
    }
    switch (event.type) {
      case 'playbackStarted': {
        // Playing from the start: the first position is measured from 0 (a resumed video's first position is a
        // jump, so it adds nothing). Started again inside the same session (retry): the session goes on.
        if (current?.mediaId !== event.mediaId) {
          begin(event.mediaId, 0);
        }
        return;
      }
      case 'positionChanged': {
        const session = sessionFor(event.mediaId);
        if (!session) return;
        if (finite(event.durationSeconds) && event.durationSeconds > 0) {
          session.durationSeconds = event.durationSeconds;
        }
        sample(session, event.positionSeconds);
        maybeCount(session, event.at);
        return;
      }
      case 'paused': {
        const session = runningSession(event.mediaId);
        if (!session) return;
        sample(session, event.positionSeconds);
        maybeCount(session, event.at);
        return;
      }
      case 'completed': {
        const session = runningSession(event.mediaId);
        if (!session) return;
        if (session.durationSeconds == null && session.lastPosition != null) {
          // Unknown length: where it ended is its length.
          session.durationSeconds = session.lastPosition;
        }
        sample(session, session.durationSeconds);
        maybeCount(session, event.at);
        return;
      }
      case 'playerExited': {
        const session = runningSession(event.mediaId);
        if (!session) return;
        sample(session, event.positionSeconds);
        maybeCount(session, event.at);
        current = null;
        return;
      }
      default:
    }
  };

  return {
    handle,
    session: () => (current ? { ...current } : null),
  };
}
