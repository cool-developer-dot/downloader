import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { emitPlaybackEvent } from '../player/playback-events';
import { bindPlaybackPersistence, unbindPlaybackPersistenceForTests } from './bind-playback-persistence';
import { PLAYBACK_LOCAL_NAMESPACE } from './constants';
import { PlaybackPersistenceCoordinator } from './coordinator';
import { isContinueWatchingEligible } from './domain/continue-watching';
import { listLocalPlaybackSummaries } from './hooks';
import { loadPlaybackState, resetPlaybackStorageForTests } from './persistence';

/**
 * P9 #687 Disable History: while it is on, the playback events never reach the coordinator, so nothing new is stored —
 * no resume point, Watch history or Continue watching. What was stored before stays. Off again: recorded as before.
 */

afterEach(() => {
  unbindPlaybackPersistenceForTests();
  resetPlaybackStorageForTests();
});

function watch(mediaId: string, at: number) {
  emitPlaybackEvent({ type: 'playbackStarted', mediaId, at });
  emitPlaybackEvent({ type: 'positionChanged', mediaId, positionSeconds: 300, durationSeconds: 1200, at: at + 1 });
  emitPlaybackEvent({ type: 'paused', mediaId, positionSeconds: 300, at: at + 2 });
  emitPlaybackEvent({ type: 'playerExited', mediaId, positionSeconds: 300, at: at + 3 });
}

test('while on, no event reaches the coordinator; off again, they do', () => {
  let paused = true;
  const handled: string[] = [];
  const coordinator = {
    handleEvent: (event: { type: string }) => handled.push(event.type),
    dispose: () => undefined,
  } as unknown as PlaybackPersistenceCoordinator;
  bindPlaybackPersistence({ coordinator, isHistoryPaused: () => paused });

  watch('library-video-1', 1);
  assert.deepEqual(handled, []);
  paused = false;
  watch('library-video-1', 10);
  assert.deepEqual(handled, ['playbackStarted', 'positionChanged', 'paused', 'playerExited']);
});

test('with the real coordinator: nothing new is stored while on, the earlier record stays, and off records again', () => {
  let paused = false;
  const now = Date.parse('2026-11-23T10:00:00.000Z');
  const coordinator = new PlaybackPersistenceCoordinator({
    getUserId: () => PLAYBACK_LOCAL_NAMESPACE,
    sync: null,
    clock: { now: () => now },
  });
  bindPlaybackPersistence({ coordinator, isHistoryPaused: () => paused });

  watch('watched-before', now - 60_000);
  const before = loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'watched-before');
  assert.equal(before?.positionSeconds, 300);

  paused = true;
  watch('watched-while-off', now - 30_000);
  // The earlier video watched again while on: its record (resume point, last played) doesn't move.
  emitPlaybackEvent({ type: 'playbackStarted', mediaId: 'watched-before', at: now - 20_000 });
  emitPlaybackEvent({ type: 'positionChanged', mediaId: 'watched-before', positionSeconds: 900, durationSeconds: 1200, at: now - 19_000 });
  emitPlaybackEvent({ type: 'playerExited', mediaId: 'watched-before', positionSeconds: 900, at: now - 18_000 });

  assert.equal(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'watched-while-off'), null, 'no resume point');
  assert.deepEqual(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'watched-before'), before, 'kept as it was');
  const summaries = listLocalPlaybackSummaries();
  assert.deepEqual(summaries.map((s) => s.mediaId), ['watched-before'], 'Watch history');
  assert.deepEqual(
    summaries.filter((s) => isContinueWatchingEligible(s)).map((s) => s.mediaId),
    ['watched-before'],
    'Continue watching',
  );

  paused = false;
  watch('watched-after', now - 5_000);
  assert.equal(loadPlaybackState(PLAYBACK_LOCAL_NAMESPACE, 'watched-after')?.positionSeconds, 300);
});
