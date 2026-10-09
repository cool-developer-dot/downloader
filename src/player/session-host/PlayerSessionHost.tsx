import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useResumePrompt } from '@/playback/use-resume-prompt';

import { usePlayerSession } from '../use-player-session';
import { shouldCloseFailedSession } from './mini-player-policy';
import {
  closePlayerSession,
  publishLiveSession,
  selectVisibilityInput,
  usePlayerSessionHostStore,
  withdrawLiveSession,
} from './player-session-store';

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
  // app in front — coming back from the background never resumes playback by itself.
  const autoPlayedGenerationRef = useRef<number | null>(null);
  useEffect(() => {
    if (!session.isReady || session.error || autoPlayedGenerationRef.current === resolveGeneration) {
      return;
    }
    autoPlayedGenerationRef.current = resolveGeneration;
    if (AppState.currentState === 'active') {
      controller.play();
    }
  }, [controller, resolveGeneration, session.error, session.isReady]);

  // Published before paint, so the Player screen and the mini player render the state this commit produced.
  useLayoutEffect(() => {
    publishLiveSession({ ...result, key: sessionKey, requestedMediaId: mediaId });
  });
  useLayoutEffect(() => () => withdrawLiveSession(sessionKey), [sessionKey]);

  return null;
}
