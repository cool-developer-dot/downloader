/**
 * P5 Repeat & loops on the Player screen: the A-B loop of the video playing (#541), playing a saved loop (#722), and
 * what a finished video does (#535 with Repeat one #539 and Repeat all #540).
 *
 * The session (`use-player-session.ts`) is not changed: this listens to the same player's `playToEnd` and acts through
 * what the session already offers (replay, exact seek, play) and the screen's Previous / Next. The decision itself is
 * `decideEndOfPlayback` (pure, unit-tested).
 *
 * Runs while the full Player shows the video, in full screen, picture-in-picture and in the background. The in-app mini
 * player keeps today's end (stop, with Replay).
 */

import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useTranslation } from '@/localization';
import {
  NO_AB_POINTS,
  abLoopJumpTarget,
  abLoopOf,
  abMarkerFractions,
  abTileStep,
  clampToVideo,
  setAbPointA,
  setAbPointB,
  type AbPoints,
} from '@/player/ab-repeat';
import { decideEndOfPlayback, type EndOfPlaybackAction } from '@/player/end-of-playback';
import { formatPlaybackTime } from '@/player/format-time';
import { abPointsLabel, endOfPlaybackLabel, loopSpanLabel } from '@/player/repeat-labels';
import { setEndOfPlaybackAction, useEndOfPlaybackAction, useSavedLoops } from '@/player/repeat-preference';
import type { SavedLoop } from '@/player/saved-loops';
import type { PlayerController } from '@/player/types';

import { announcePlayer } from './use-player-not-yet';

/** How often the position is read while an A-B loop plays. */
const AB_POLL_MS = 100;

/** An automatic move to the next video, waiting for that video to load (see `useContinueAfterAutoAdvance`). */
let pendingAutoAdvance: { mediaId: string; at: number } | null = null;
const AUTO_ADVANCE_WINDOW_MS = 30_000;

function readCurrentTime(player: VideoPlayer): number {
  try {
    const time = player.currentTime;
    return Number.isFinite(time) ? time : 0;
  } catch {
    // A released player: nothing to read.
    return 0;
  }
}

export type PlayerRepeatInput = {
  player: VideoPlayer;
  controller: PlayerController;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  isSeeking: boolean;
  hasError: boolean;
  durationSeconds: number | null;
  /** The session's replay (from the start, playing). */
  replay: () => void;
  /** An exact seek through the session. */
  seekExact: (seconds: number) => void;
  /** The play queue in play order (`play-queue.ts` `ids`). */
  queue: readonly string[];
  /** Opens another video in this Player (Previous / Next's way). */
  goToMedia: (mediaId: string) => void;
};

export type PlayerRepeat = {
  points: AbPoints;
  /** A and B on the timeline as fractions (null where not set). */
  markers: { a: number | null; b: number | null };
  abLabel: string;
  endAction: EndOfPlaybackAction;
  endActionLabel: string;
  loops: SavedLoop[];
  setEndAction: (action: EndOfPlaybackAction) => void;
  setA: () => void;
  setB: () => void;
  clear: () => void;
  /** The A-B tile: set A, then B, then (a loop is on) ask for the sheet. Returns true when the sheet should open. */
  onTile: () => boolean;
  playLoop: (loop: SavedLoop) => void;
};

export function usePlayerRepeat(input: PlayerRepeatInput): PlayerRepeat {
  const { t } = useTranslation();
  const { player, controller, mediaId, isReady, isPlaying, isSeeking, hasError, durationSeconds, replay, seekExact } =
    input;
  const endAction = useEndOfPlaybackAction();
  const loops = useSavedLoops(mediaId);
  const canCommand = isReady && !hasError;

  // The loop belongs to the video it was set on: another video starts without one.
  const [abState, setAbState] = useState<{ mediaId: string | null; points: AbPoints }>({
    mediaId,
    points: NO_AB_POINTS,
  });
  const points = abState.mediaId === mediaId ? abState.points : NO_AB_POINTS;
  const loop = abLoopOf(points, durationSeconds);
  const loopStart = loop?.startSeconds ?? null;
  const loopEnd = loop?.endSeconds ?? null;

  // #541: playing into B goes back to A. Not while the user drags the timeline.
  useEffect(() => {
    if (loopStart == null || loopEnd == null || !isPlaying || isSeeking) {
      return;
    }
    const range = { startSeconds: loopStart, endSeconds: loopEnd };
    const timer = setInterval(() => {
      const target = abLoopJumpTarget(range, readCurrentTime(player));
      if (target != null) {
        seekExact(target);
      }
    }, AB_POLL_MS);
    return () => clearInterval(timer);
  }, [isPlaying, isSeeking, loopEnd, loopStart, player, seekExact]);

  // What the end decides with, read when the video ends (not when this renders).
  const latest = useRef({ loop, endAction, queue: input.queue, mediaId, goToMedia: input.goToMedia, replay, seekExact });
  useEffect(() => {
    latest.current = { loop, endAction, queue: input.queue, mediaId, goToMedia: input.goToMedia, replay, seekExact };
  });

  useEventListener(player, 'playToEnd', () => {
    // After the session's own handler (it marks the video finished): a microtask runs once every listener has, and
    // before React renders, so a repeat never flashes the Replay button.
    void Promise.resolve().then(() => {
      const now = latest.current;
      const outcome = decideEndOfPlayback({
        loop: now.loop,
        action: now.endAction,
        queue: now.queue,
        mediaId: now.mediaId,
      });
      switch (outcome.kind) {
        case 'loop':
          now.seekExact(outcome.seekSeconds);
          controller.play();
          return;
        case 'replay':
          now.replay();
          return;
        case 'next':
          pendingAutoAdvance = { mediaId: outcome.mediaId, at: Date.now() };
          now.goToMedia(outcome.mediaId);
          return;
        case 'stop':
          return;
      }
    });
  });

  const announceLoop = useCallback(
    (next: AbPoints) => {
      const nextLoop = abLoopOf(next, durationSeconds);
      if (nextLoop) {
        announcePlayer(
          t('videoPlayer.abLoopOn', { span: loopSpanLabel(nextLoop.startSeconds, nextLoop.endSeconds) }),
        );
      } else if (next.a != null) {
        announcePlayer(t('videoPlayer.abASet', { time: formatPlaybackTime(next.a) }));
      } else if (next.b != null) {
        announcePlayer(t('videoPlayer.abBSet', { time: formatPlaybackTime(next.b) }));
      }
    },
    [durationSeconds, t],
  );

  const setPoint = useCallback(
    (which: 'a' | 'b') => {
      if (!canCommand) {
        return;
      }
      const here = readCurrentTime(player);
      const result =
        which === 'a' ? setAbPointA(points, here, durationSeconds) : setAbPointB(points, here, durationSeconds);
      if (!result.ok) {
        announcePlayer(t('videoPlayer.abTooShort'));
        return;
      }
      setAbState({ mediaId, points: result.points });
      announceLoop(result.points);
    },
    [announceLoop, canCommand, durationSeconds, mediaId, player, points, t],
  );

  const clear = useCallback(() => {
    setAbState({ mediaId, points: NO_AB_POINTS });
    announcePlayer(t('videoPlayer.abCleared'));
  }, [mediaId, t]);

  const onTile = useCallback(() => {
    const step = abTileStep(points);
    if (step === 'openSheet') {
      return true;
    }
    if (!canCommand) {
      return true;
    }
    setPoint(step === 'setA' ? 'a' : 'b');
    return false;
  }, [canCommand, points, setPoint]);

  const playLoop = useCallback(
    (saved: SavedLoop) => {
      if (!canCommand) {
        return;
      }
      const start = clampToVideo(saved.startMs / 1000, durationSeconds);
      const end = clampToVideo(saved.endMs / 1000, durationSeconds);
      const next = { a: start, b: end };
      if (!abLoopOf(next, durationSeconds)) {
        announcePlayer(t('videoPlayer.abTooShort'));
        return;
      }
      setAbState({ mediaId, points: next });
      seekExact(start);
      controller.play();
      announcePlayer(t('videoPlayer.loopPlaying', { name: saved.name }));
    },
    [canCommand, controller, durationSeconds, mediaId, seekExact, t],
  );

  const setEndAction = useCallback(
    (action: EndOfPlaybackAction) => {
      setEndOfPlaybackAction(action);
      announcePlayer(endOfPlaybackLabel(t, action));
    },
    [t],
  );

  const markers = useMemo(() => abMarkerFractions(points, durationSeconds), [durationSeconds, points]);

  return {
    points,
    markers,
    abLabel: abPointsLabel(t, points, durationSeconds),
    endAction,
    endActionLabel: endOfPlaybackLabel(t, endAction),
    loops,
    setEndAction,
    setA: () => setPoint('a'),
    setB: () => setPoint('b'),
    clear,
    onTile,
    playLoop,
  };
}

/**
 * After Repeat all moved to the next video: the session's host starts a newly opened video only with the app in
 * front. A video that ended in picture-in-picture or with background play on carries on into the next one.
 */
export function useContinueAfterAutoAdvance(input: {
  controller: PlayerController;
  mediaId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  hasError: boolean;
}): void {
  const { controller, mediaId, isReady, isPlaying, hasError } = input;
  useEffect(() => {
    const pending = pendingAutoAdvance;
    if (!pending || pending.mediaId !== mediaId) {
      return;
    }
    if (Date.now() - pending.at > AUTO_ADVANCE_WINDOW_MS || hasError || isPlaying) {
      pendingAutoAdvance = null;
      return;
    }
    if (!isReady) {
      return;
    }
    pendingAutoAdvance = null;
    if (AppState.currentState !== 'active') {
      controller.play();
    }
  }, [controller, hasError, isPlaying, isReady, mediaId]);
}
