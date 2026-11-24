import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useResumePrompt } from '@/playback/use-resume-prompt';

import { useSleepLimitSession } from '../engine/use-sleep-limits';
import { usePlayerSession } from '../use-player-session';
import { shouldCloseFailedSession } from './mini-player-policy';
import {
  closePlayerSession,
  publishLiveSession,
  selectVisibilityInput,
  usePlayerSessionHostStore,
  withdrawLiveSession,
} from './player-session-store';
import { takeSessionAutoAdvance } from './session-end-of-playback';
import { useSessionEndOfPlayback } from './use-session-end-of-playback';
import { useSessionQueueCommands } from './use-session-queue-commands';

/**
 * Runs the app's one player session (see player-session-store). Mounted once in the app stack, beside the navigator:
 * a new session remounts only the runner (one native player per session, released with it), never the screens.
 */
export const PlayerSessionHost = memo(function PlayerSessionHost() {
  const request = usePlayerSessionHostStore((s) => s.request);
  const closeFailed = usePlayerSessionHostStore((s) => shouldCloseFailedSession(selectVisibilityInput(s)));

  useEffect(() => {
    if (closeFailed) {
      closePlayerSession();
    }
  }, [closeFailed]);

  if (!request) {
    return null;
  }
  return <PlayerSessionRunner key={request.key} sessionKey={request.key} mediaId={request.mediaId} />;
});

type RunnerProps = { sessionKey: number; mediaId: string | null };

function PlayerSessionRunner({ sessionKey, mediaId }: RunnerProps) {
  const result = usePlayerSession(mediaId);
  const { session, controller, resolveGeneration } = result;
  const activeMediaId = session.mediaId ?? mediaId;

  // Auto-resume seek (no Resume/Start Over sheet); the Player's cover stays until the first frame, so the seek happens
  // behind it.
  useResumePrompt({
    mediaId,
    isReady: session.isReady,
    resolveGeneration,
    controller,
    activeMediaId,
  });

  // Opens with autoplay: once per loaded media (a retry loads again), after the resume seek above, and only with the
  // app in front — coming back from the background never resumes playback by itself. The one exception: the next video
  // the runner moved to by itself at the end of the last (below), which carries on as background play did.
  const autoPlayedGenerationRef = useRef<number | null>(null);
  useEffect(() => {
    if (!session.isReady || session.error || autoPlayedGenerationRef.current === resolveGeneration) {
      return;
    }
    autoPlayedGenerationRef.current = resolveGeneration;
    const autoAdvanced = takeSessionAutoAdvance(mediaId);
    if (AppState.currentState === 'active' || autoAdvanced) {
      controller.play();
    }
  }, [controller, mediaId, resolveGeneration, session.error, session.isReady]);

  // P5 / P6 with no full Player showing this session (the mini player): Repeat one, Repeat all and Auto Play Next.
  useSessionEndOfPlayback({ player: result.player, mediaId: activeMediaId, replay: result.replay });
  // P15 there too: a headset's, a remote's or the notification's ⏭ / ⏮ move through the queue.
  useSessionQueueCommands({
    player: result.player,
    mediaId: activeMediaId,
    isReady: session.isReady,
    positionSeconds: session.positionSeconds,
    restart: () => controller.seekTo(0),
  });

  // Faran's P18: the sleep timer and the daily limit follow the session — full Player, mini player, screen off.
  useSleepLimitSession({
    player: result.player,
    isReady: session.isReady,
    isPlaying: session.isPlaying,
    isCompleted: session.isCompleted,
    pause: controller.pause,
  });

  // Published before paint, so the Player screen and the mini player render the state this commit produced.
  useLayoutEffect(() => {
    publishLiveSession({ ...result, key: sessionKey, requestedMediaId: mediaId });
  });
  useLayoutEffect(() => () => withdrawLiveSession(sessionKey), [sessionKey]);

  return null;
}
