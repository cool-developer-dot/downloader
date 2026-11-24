/**
 * The session runner's end of a video with no full Player showing it (the mini player, or the app in the background
 * after leaving the Player): Repeat one, Repeat all and Auto Play Next carry on there. See `session-end-of-playback.ts`.
 */

import { useEventListener } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { useLayoutEffect, useRef } from 'react';

import { getAutoPlayNext } from '../auto-next-preference';
import { isRealPlayToEnd, readPlayerDuration } from '../end-of-playback';
import { isSleepAtEndOfVideo } from '../engine/sleep-limits';
import { setPlayQueueCurrent, usePlayQueueStore } from '../play-queue';
import { loadQueueMediaIndex, nextInFolder } from '../queue-media';
import { getEndOfPlaybackAction } from '../repeat-preference';
import { openPlayerSession, usePlayerSessionHostStore } from './player-session-store';
import { markSessionAutoAdvance, runSessionEndOfPlayback } from './session-end-of-playback';

export function useSessionEndOfPlayback(input: {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  hasError: boolean;
  replay: () => void;
}): void {
  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  useEventListener(input.player, 'playToEnd', () => {
    // Not the empty player's "end" before the video loads (see isRealPlayToEnd).
    const { isReady, hasError, player } = latest.current;
    if (!isRealPlayToEnd({ isReady, hasError, playerDurationSeconds: readPlayerDuration(player) })) {
      return;
    }
    // After the session's own handler (it marks the video finished), like the full Player's `use-repeat.ts`.
    void Promise.resolve().then(() =>
      runSessionEndOfPlayback(latest.current.mediaId, {
        fullPlayerCount: () => usePlayerSessionHostStore.getState().fullPlayerCount,
        endAction: getEndOfPlaybackAction,
        queue: () => usePlayQueueStore.getState().ids,
        autoPlayNext: getAutoPlayNext,
        folderNextId: async (mediaId) => nextInFolder(await loadQueueMediaIndex(), mediaId),
        sleepAtEnd: isSleepAtEndOfVideo,
        replay: () => latest.current.replay(),
        openNext: (mediaId) => {
          markSessionAutoAdvance(mediaId);
          setPlayQueueCurrent(mediaId);
          openPlayerSession(mediaId);
        },
      }),
    );
  });
}
