import { useLayoutEffect } from 'react';

import {
  attachFullPlayer,
  openPlayerSession,
  usePlayerSessionHostStore,
  type LivePlayerSession,
} from './player-session-store';

/**
 * The full Player screen's view of the shared session: opens (or keeps) the session for the route's media and marks
 * the full Player as showing it while mounted (the mini player hides meanwhile). Returns the live session once it
 * serves this media — null for the first frames of a newly opened one.
 */
export function useFullPlayerSession(mediaId: string | null): LivePlayerSession | null {
  useLayoutEffect(() => attachFullPlayer(), []);
  useLayoutEffect(() => {
    openPlayerSession(mediaId);
  }, [mediaId]);
  return usePlayerSessionHostStore((s) =>
    s.live && s.request?.key === s.live.key && s.live.requestedMediaId === mediaId ? s.live : null,
  );
}
