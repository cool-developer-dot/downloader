import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { emitPlaybackEvent } from '../player/playback-events';
import { bindPlaybackPersistence, unbindPlaybackPersistenceForTests } from './bind-playback-persistence';
import type { PlaybackPersistenceCoordinator } from './coordinator';

afterEach(() => unbindPlaybackPersistenceForTests());

test('an online stream (F17) leaves no resume record and no Watch history; library videos still do', () => {
  const handled: string[] = [];
  const coordinator = {
    handleEvent: (event: { mediaId: string }) => handled.push(event.mediaId),
    dispose: () => undefined,
  } as unknown as PlaybackPersistenceCoordinator;
  bindPlaybackPersistence({ coordinator });

  const stream = `stream:${'b'.repeat(32)}`;
  for (const mediaId of [stream, 'library-video-1']) {
    emitPlaybackEvent({ type: 'playbackStarted', mediaId, at: 1 });
    emitPlaybackEvent({ type: 'positionChanged', mediaId, positionSeconds: 30, durationSeconds: 120, at: 2 });
    emitPlaybackEvent({ type: 'playerExited', mediaId, positionSeconds: 30, at: 3 });
  }

  assert.deepEqual(handled, ['library-video-1', 'library-video-1', 'library-video-1']);
});
