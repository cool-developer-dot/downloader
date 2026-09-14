/**
 * App bootstrap binder — keeps react-native / API client off the Node verify path.
 * Import only from app-initializer.
 */

import {
  subscribePlaybackEvents,
  type PlaybackEventListener,
} from '../player/playback-events';
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

  const listener: PlaybackEventListener = (event) => {
    coordinator?.handleEvent(event);
  };
  unsubEvents = subscribePlaybackEvents(listener);
  bound = true;
  return coordinator;
}

export function getPlaybackCoordinator(): PlaybackPersistenceCoordinator | null {
  return coordinator;
}

export function unbindPlaybackPersistenceForTests(): void {
  unsubEvents?.();
  unsubEvents = null;
  coordinator?.dispose();
  coordinator = null;
  bound = false;
}
