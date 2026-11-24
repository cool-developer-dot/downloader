/**
 * The session runner's ⏭ / ⏮ (headset, remote, notification) while no full Player shows the session: the mini player,
 * or the app in the background after leaving the Player. See `session-queue-commands.ts`.
 */

import type { VideoPlayer } from 'expo-video';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { useHeadsetKeySettings } from '../engine/headset-keys';
import { applyQueueNavigation, subscribeQueueCommands } from '../engine/native-player';
import { setPlayQueueCurrent, usePlayQueueNeighbours, usePlayQueueStore } from '../play-queue';
import { openPlayerSession, usePlayerSessionHostStore } from './player-session-store';
import { markSessionAutoAdvance } from './session-end-of-playback';
import { sessionQueueCommand } from './session-queue-commands';

export function useSessionQueueCommands(input: {
  player: VideoPlayer;
  mediaId: string | null;
  isReady: boolean;
  positionSeconds: number;
  /** Back to the start of this video (playing on as it was). */
  restart: () => void;
}): void {
  const { player, mediaId, isReady } = input;
  const fullPlayerShowing = usePlayerSessionHostStore((s) => s.fullPlayerCount > 0);
  const settings = useHeadsetKeySettings();
  const { previousId, nextId } = usePlayQueueNeighbours(mediaId);
  const hasNext = nextId != null;
  const hasPrevious = previousId != null;

  // The notification shows ⏮ / ⏭ for this video's place in the queue (the full Player sets them while it shows).
  useEffect(() => {
    if (isReady && !fullPlayerShowing) {
      applyQueueNavigation(player, { enabled: settings.headsetButtons, hasNext, hasPrevious });
    }
  }, [fullPlayerShowing, hasNext, hasPrevious, isReady, player, settings.headsetButtons]);

  const latest = useRef(input);
  useLayoutEffect(() => {
    latest.current = input;
  });

  useEffect(
    () =>
      subscribeQueueCommands((command) => {
        if (usePlayerSessionHostStore.getState().fullPlayerCount > 0) {
          return;
        }
        const now = latest.current;
        const outcome = sessionQueueCommand(command, {
          ids: usePlayQueueStore.getState().ids,
          mediaId: now.mediaId,
          positionSeconds: now.positionSeconds,
        });
        if (outcome.kind === 'open') {
          // Pressed on a headset or the lock screen: the next video plays even with the app in the background.
          markSessionAutoAdvance(outcome.mediaId);
          setPlayQueueCurrent(outcome.mediaId);
          openPlayerSession(outcome.mediaId);
        } else if (outcome.kind === 'restart') {
          now.restart();
        }
      }),
    [],
  );
}
