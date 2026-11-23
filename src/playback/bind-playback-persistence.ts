/**
 * App bootstrap binder — keeps react-native / API client off the Node verify path.
 * Import only from app-initializer.
 */

import {
  subscribePlaybackEvents,
  type PlaybackEventListener,
} from '../player/playback-events';
import { isStreamMediaId } from '../player/remote-stream';
import { PLAYBACK_LOCAL_NAMESPACE } from './constants';
import {
  PlaybackPersistenceCoordinator,
  type PlaybackCoordinatorDeps,
} from './coordinator';
import { invalidatePlaybackUiQueries } from './query-keys';

let coordinator: PlaybackPersistenceCoordinator | null = null;
let unsubEvents: (() => void) | null = null;
let bound = false;

function resolveLocalNamespace(): string {
  return PLAYBACK_LOCAL_NAMESPACE;
}

function defaultSubscribeAppState(
  listener: (status: string) => void,
): () => void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rn = require('react-native') as {
      AppState: {
        addEventListener: (
          type: string,
          cb: (status: string) => void,
        ) => { remove: () => void };
      };
    };
    const sub = rn.AppState.addEventListener('change', listener);
    return () => {
      sub.remove();
    };
  } catch {
    return () => undefined;
  }
}

/** P9 #687: Disable History, read lazily so this module still imports under the test runner (no MMKV there). */
function defaultHistoryPaused(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const preference = require('./history-pause-preference') as { isWatchHistoryPaused: () => boolean };
    return preference.isWatchHistoryPaused();
  } catch {
    return false;
  }
}

function defaultBoundaryFlush(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { queryClient } = require('../services/query-client') as {
      queryClient: import('@tanstack/react-query').QueryClient;
    };
    invalidatePlaybackUiQueries(queryClient);
  } catch {
    // optional during early bootstrap / Node verify
  }
}

/**
 * Idempotent bootstrap binding — exactly one subscriber to playback events.
 * Local persistence only; no cloud playback transport.
 */
export function bindPlaybackPersistence(
  overrides?: Partial<PlaybackCoordinatorDeps> & {
    coordinator?: PlaybackPersistenceCoordinator;
    /** P9 #687: true while Disable History is on (default: the app-wide setting). */
    isHistoryPaused?: () => boolean;
  },
): PlaybackPersistenceCoordinator {
  if (bound && coordinator && !overrides?.coordinator) {
    return coordinator;
  }

  unsubEvents?.();
  coordinator?.dispose();

  coordinator =
    overrides?.coordinator ??
    new PlaybackPersistenceCoordinator({
      getUserId: overrides?.getUserId ?? resolveLocalNamespace,
      sync: overrides?.sync === undefined ? null : overrides.sync,
      clock: overrides?.clock,
      localPersistIntervalMs: overrides?.localPersistIntervalMs,
      backendSyncIntervalMs: overrides?.backendSyncIntervalMs,
      subscribeAppState:
        overrides?.subscribeAppState ?? defaultSubscribeAppState,
      subscribeNetworkReconnect: overrides?.subscribeNetworkReconnect,
      onBoundaryFlush:
        overrides?.onBoundaryFlush ??
        ((_reason, _mediaId) => {
          defaultBoundaryFlush();
        }),
    });

  const historyPaused = overrides?.isHistoryPaused ?? defaultHistoryPaused;
  const listener: PlaybackEventListener = (event) => {
    // An online stream (F17) is not a library video: no resume record, no Watch history, no Continue watching.
    if (isStreamMediaId(event.mediaId)) {
      return;
    }
    // P9 #687 Disable History: while on, nothing new is stored either (the coordinator is the only writer of resume
    // points, Watch history and Continue watching). What was stored before stays.
    if (historyPaused()) {
      return;
    }
    coordinator?.handleEvent(event);
  };
  unsubEvents = subscribePlaybackEvents(listener);
  bound = true;
  return coordinator;
}

export function getPlaybackCoordinator(): PlaybackPersistenceCoordinator | null {
  return coordinator;
}

/**
 * P11 #686: when the session the coordinator holds in memory is `mediaId`'s (a video just moved to Private), it is
 * dropped without being written, so the next video's start (or the app going to the background) can't write that
 * video's position back. True when one was dropped.
 */
export function dropPlaybackSessionFor(mediaId: string): boolean {
  if (!coordinator || !mediaId || coordinator.getActiveState()?.mediaId !== mediaId) {
    return false;
  }
  coordinator.resetForLogout();
  return true;
}

export function unbindPlaybackPersistenceForTests(): void {
  unsubEvents?.();
  unsubEvents = null;
  coordinator?.dispose();
  coordinator = null;
  bound = false;
}
