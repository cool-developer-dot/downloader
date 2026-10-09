/**
 * The app's one player session, shared by the full Player screen and the in-app mini player.
 *
 * The session (its native player, resume seek, autoplay, background / PiP policy, playback events) runs in
 * `PlayerSessionHost`, mounted once in the app stack — not in the Player screen — so leaving the full Player keeps the
 * same player and position playing in the mini player. The Player screen and the mini player only attach views to it.
 * Opening another media replaces the session (the old player is released, `playerExited` saves its position);
 * closing the mini player ends it.
 */

import { createStore } from '@/store/shared/create-store';

import type { UsePlayerSessionResult } from '../use-player-session';
import { shouldReuseSession, type MiniPlayerVisibilityInput } from './mini-player-policy';

export type PlayerSessionRequest = {
  /** New per opened session: the host keys the runner (and views key their VideoView) by it. */
  key: number;
  mediaId: string | null;
};

/** The running session as published by the host: its hook result, tagged with the request it serves. */
export type LivePlayerSession = UsePlayerSessionResult & { key: number; requestedMediaId: string | null };

type PlayerSessionHostState = {
  request: PlayerSessionRequest | null;
  live: LivePlayerSession | null;
  fullPlayerCount: number;
  pictureInPictureActive: boolean;
};

export const usePlayerSessionHostStore = createStore<PlayerSessionHostState>()(() => ({
  request: null,
  live: null,
  fullPlayerCount: 0,
  pictureInPictureActive: false,
}));

let nextSessionKey = 1;

/** Opens (or keeps) the session for a media; returns its key. */
export function openPlayerSession(mediaId: string | null): number {
  const state = usePlayerSessionHostStore.getState();
  const running = state.request
    ? { mediaId: state.request.mediaId, error: state.live?.key === state.request.key ? state.live.session.error : null }
    : null;
  if (state.request && shouldReuseSession(running, mediaId)) {
    return state.request.key;
  }
  const key = nextSessionKey++;
  usePlayerSessionHostStore.setState({ request: { key, mediaId }, live: null, pictureInPictureActive: false });
  return key;
}

/** Ends the session: the host unmounts its runner, which pauses, reports the exit position and releases the player. */
export function closePlayerSession(key?: number): void {
  const { request } = usePlayerSessionHostStore.getState();
  if (!request || (key != null && request.key !== key)) {
    return;
  }
  usePlayerSessionHostStore.setState({ request: null, live: null, pictureInPictureActive: false });
}

/** A full Player screen shows the session; the returned function detaches it. */
export function attachFullPlayer(): () => void {
  usePlayerSessionHostStore.setState((s) => ({ fullPlayerCount: s.fullPlayerCount + 1 }));
  let attached = true;
  return () => {
    if (!attached) {
      return;
    }
    attached = false;
    usePlayerSessionHostStore.setState((s) => ({
      fullPlayerCount: Math.max(0, s.fullPlayerCount - 1),
      pictureInPictureActive: false,
    }));
  };
}

export function setPlayerSessionPictureInPicture(active: boolean): void {
  if (usePlayerSessionHostStore.getState().pictureInPictureActive !== active) {
    usePlayerSessionHostStore.setState({ pictureInPictureActive: active });
  }
}

/** Host only: the runner for `key` publishes its current state (ignored once another session was opened). */
export function publishLiveSession(live: LivePlayerSession): void {
  const { request } = usePlayerSessionHostStore.getState();
  if (request?.key === live.key) {
    usePlayerSessionHostStore.setState({ live });
  }
}

/** Host only: the runner for `key` is gone. */
export function withdrawLiveSession(key: number): void {
  if (usePlayerSessionHostStore.getState().live?.key === key) {
    usePlayerSessionHostStore.setState({ live: null });
  }
}

export function selectVisibilityInput(state: PlayerSessionHostState): MiniPlayerVisibilityInput {
  const live = state.live;
  return {
    session:
      live && state.request?.key === live.key
        ? {
            mediaId: live.requestedMediaId,
            error: live.session.error,
            isCompleted: live.session.isCompleted,
            isPlaying: live.session.isPlaying,
            isReady: live.session.isReady,
          }
        : null,
    fullPlayerCount: state.fullPlayerCount,
    pictureInPictureActive: state.pictureInPictureActive,
  };
}

/** Tests only. */
export function __resetPlayerSessionHostForTests(): void {
  nextSessionKey = 1;
  usePlayerSessionHostStore.setState({ request: null, live: null, fullPlayerCount: 0, pictureInPictureActive: false });
}
