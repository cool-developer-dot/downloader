import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  isResumable,
  selectContinueWatching,
  selectRecentlyWatched,
  watchedFraction,
  type SavedPlayback,
} from './continue-watching.ts';

function playback(mediaId: string, overrides: Partial<SavedPlayback> = {}): SavedPlayback {
  return {
    mediaId,
    positionSeconds: 120,
    durationSeconds: 600,
    completed: false,
    lastPlayedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('isResumable', () => {
  test('a video part-way through is resumable', () => {
    assert.equal(isResumable(playback('a')), true);
  });

  test('completed, barely started or never played videos are not', () => {
    assert.equal(isResumable(playback('a', { completed: true })), false);
    assert.equal(isResumable(playback('a', { positionSeconds: 10 })), false);
    assert.equal(isResumable(playback('a', { lastPlayedAt: null })), false);
    assert.equal(isResumable(playback('a', { lastPlayedAt: 'not a date' })), false);
  });

  test('videos within the near-end window count as finished', () => {
    assert.equal(isResumable(playback('a', { positionSeconds: 575, durationSeconds: 600 })), false);
    assert.equal(isResumable(playback('a', { positionSeconds: 38, durationSeconds: 40 })), false);
    assert.equal(isResumable(playback('a', { positionSeconds: 20, durationSeconds: 40 })), true);
  });

  test('an unknown duration still resumes', () => {
    assert.equal(isResumable(playback('a', { durationSeconds: 0 })), true);
  });
});

describe('shelf selection', () => {
  const states = [
    playback('older', { lastPlayedAt: '2026-09-01T08:00:00.000Z' }),
    playback('finished', { completed: true, lastPlayedAt: '2026-09-02T08:00:00.000Z' }),
    playback('newest', { lastPlayedAt: '2026-09-03T08:00:00.000Z' }),
    playback('never', { lastPlayedAt: null }),
  ];

  test('continue watching keeps resumable items, newest first, up to the limit', () => {
    assert.deepEqual(
      selectContinueWatching(states, 10).map((state) => state.mediaId),
      ['newest', 'older'],
    );
    assert.deepEqual(
      selectContinueWatching(states, 1).map((state) => state.mediaId),
      ['newest'],
    );
  });

  test('recently watched includes finished items but not unplayed ones', () => {
    assert.deepEqual(
      selectRecentlyWatched(states, 10).map((state) => state.mediaId),
      ['newest', 'finished', 'older'],
    );
  });

  test('does not reorder the input', () => {
    const before = states.map((state) => state.mediaId);
    selectRecentlyWatched(states, 10);
    assert.deepEqual(
      states.map((state) => state.mediaId),
      before,
    );
  });
});

test('watchedFraction clamps and handles unknown durations', () => {
  assert.equal(watchedFraction(playback('a', { positionSeconds: 150, durationSeconds: 600 })), 0.25);
  assert.equal(watchedFraction(playback('a', { positionSeconds: 700, durationSeconds: 600 })), 1);
  assert.equal(watchedFraction(playback('a', { durationSeconds: 0 })), 0);
});
