import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { PLAYBACK_LOCAL_NAMESPACE } from './constants';
import { listLocalPlaybackSummaries, resolvePlaybackSummary } from './hooks';
import { resetPlaybackStorageForTests, savePlaybackState } from './persistence';

afterEach(() => resetPlaybackStorageForTests());

function played(mediaId: string) {
  savePlaybackState(PLAYBACK_LOCAL_NAMESPACE, {
    mediaId,
    positionSeconds: 30,
    durationSeconds: 120,
    progressPercent: 25,
    lastPlayedAt: new Date(1_700_000_000_000).toISOString(),
    completed: false,
    updatedAt: new Date(1_700_000_000_000).toISOString(),
    pendingSync: false,
  });
}

test('a file opened from another app keeps its position but stays out of history and Continue watching', () => {
  const external = 'external:0123456789abcdef0123456789abcdef';
  played('library-video-1');
  played(external);

  assert.deepEqual(
    listLocalPlaybackSummaries().map((s) => s.mediaId),
    ['library-video-1'],
  );
  assert.equal(resolvePlaybackSummary(external)?.positionSeconds, 30, 'resume still works for the same file');
});
