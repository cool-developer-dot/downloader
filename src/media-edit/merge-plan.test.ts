/**
 * P12 Merge videos (#682): the list (up / down, add, remove; each video once; the one it started from stays), when a
 * merge can run, the output's size and how each video fits in it (the same numbers as MergePlanTest.kt), the space it
 * needs and the request.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MERGE_MAX_VIDEOS,
  isMergeCandidate,
  mergeAdd,
  mergeAvailability,
  mergeEstimateBytes,
  mergeFillsFrame,
  mergeFitInside,
  mergeHasAudio,
  mergeMoveDown,
  mergeMoveUp,
  mergeOutputSize,
  mergeRemove,
  mergeRequest,
  mergeToggle,
  mergeTotalMs,
  type MergeSource,
} from './merge-plan';

function video(id: string, overrides: Partial<MergeSource> = {}): MergeSource {
  return {
    id,
    title: `Clip ${id}`,
    mimeType: 'video/mp4',
    durationMs: 60_000,
    sizeBytes: 100_000_000,
    hasAudio: true,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe('Merge videos: the list', () => {
  test('moves a video up or down one place; the ends stay put', () => {
    assert.deepEqual(mergeMoveUp(['a', 'b', 'c'], 2), ['a', 'c', 'b']);
    assert.deepEqual(mergeMoveUp(['a', 'b', 'c'], 0), ['a', 'b', 'c']);
    assert.deepEqual(mergeMoveDown(['a', 'b', 'c'], 0), ['b', 'a', 'c']);
    assert.deepEqual(mergeMoveDown(['a', 'b', 'c'], 2), ['a', 'b', 'c']);
    assert.deepEqual(mergeMoveUp(['a', 'b'], 5), ['a', 'b']);
    assert.deepEqual(mergeMoveDown(['a', 'b'], -1), ['a', 'b']);
  });

  test('each video once, at most ten, and the video it started from never leaves', () => {
    assert.deepEqual(mergeAdd(['a'], 'b'), ['a', 'b']);
    assert.deepEqual(mergeAdd(['a', 'b'], 'a'), ['a', 'b']);
    const full = Array.from({ length: MERGE_MAX_VIDEOS }, (_, i) => `v${i}`);
    assert.deepEqual(mergeAdd(full, 'extra'), full);
    assert.deepEqual(mergeRemove(['a', 'b', 'c'], 'b', 'a'), ['a', 'c']);
    assert.deepEqual(mergeRemove(['a', 'b'], 'a', 'a'), ['a', 'b']);
    assert.deepEqual(mergeToggle(['a'], 'b', 'a'), ['a', 'b']);
    assert.deepEqual(mergeToggle(['a', 'b'], 'b', 'a'), ['a']);
    assert.deepEqual(mergeToggle(['b', 'a'], 'a', 'a'), ['b', 'a']);
  });

  test('the picker lists library videos with a length, not audio', () => {
    assert.equal(isMergeCandidate(video('a')), true);
    assert.equal(isMergeCandidate(video('a', { mimeType: 'audio/mp4' })), false);
    assert.equal(isMergeCandidate(video('a', { durationMs: null })), false);
  });
});

describe('Merge videos: when it can run', () => {
  test('two to ten different videos with a length; the first with a size', () => {
    assert.equal(mergeAvailability([video('a'), video('b')]), 'ok');
    assert.equal(mergeAvailability([video('a')]), 'too-few');
    assert.equal(mergeAvailability(Array.from({ length: 11 }, (_, i) => video(`v${i}`))), 'too-many');
    assert.equal(mergeAvailability([video('a'), video('a')]), 'duplicate');
    assert.equal(mergeAvailability([video('a'), video('b', { mimeType: 'audio/mp4' })]), 'audio-source');
    assert.equal(mergeAvailability([video('a'), video('b', { durationMs: 0 })]), 'no-duration');
    assert.equal(mergeAvailability([video('a', { width: null }), video('b')]), 'no-size');
    // Only the first video's size matters.
    assert.equal(mergeAvailability([video('a'), video('b', { width: null })]), 'ok');
  });
});

describe('Merge videos: the size (the same numbers as Kotlin)', () => {
  test('the output is the first video, in even numbers', () => {
    assert.deepEqual(mergeOutputSize(video('a')), { width: 1920, height: 1080 });
    assert.deepEqual(mergeOutputSize(video('a', { width: 853, height: 480 })), { width: 852, height: 480 });
    assert.deepEqual(mergeOutputSize(video('a', { width: 1, height: 1 })), { width: 2, height: 2 });
    assert.equal(mergeOutputSize(video('a', { height: null })), null);
  });

  test('every video fits inside it with its aspect kept', () => {
    assert.deepEqual(mergeFitInside(1920, 1080, 1280, 720), { width: 1920, height: 1080 });
    assert.deepEqual(mergeFitInside(1920, 1080, 1080, 1920), { width: 608, height: 1080 });
    assert.deepEqual(mergeFitInside(1920, 1080, 640, 480), { width: 1440, height: 1080 });
    assert.deepEqual(mergeFitInside(1080, 1920, 1920, 1080), { width: 1080, height: 608 });
    assert.equal(mergeFillsFrame({ width: 1920, height: 1080 }, video('b', { width: 1280, height: 720 })), true);
    assert.equal(mergeFillsFrame({ width: 1920, height: 1080 }, video('b', { width: 1080, height: 1920 })), false);
  });
});

describe('Merge videos: space, sound and the request', () => {
  test('the space is every video re-encoded; the length all of them together', () => {
    assert.equal(mergeEstimateBytes([video('a'), video('b'), video('c')]), 600_000_000);
    assert.equal(mergeTotalMs([video('a'), video('b', { durationMs: 30_500 })]), 90_500);
  });

  test('sound when any video has it; the videos in order; started from the playing one', () => {
    assert.equal(mergeHasAudio([video('a', { hasAudio: false }), video('b')]), true);
    assert.equal(mergeHasAudio([video('a', { hasAudio: false }), video('b', { hasAudio: false })]), false);
    assert.deepEqual(mergeRequest('b', [video('a', { hasAudio: false }), video('b')], 'Clip b (merged)'), {
      sourceId: 'b',
      kind: 'merge',
      startMs: null,
      endMs: null,
      keyframeStart: false,
      video: 'h264',
      audio: 'aac',
      title: 'Clip b (merged)',
      sourceIds: ['a', 'b'],
    });
    assert.equal(mergeRequest('a', [video('a', { hasAudio: false }), video('b', { hasAudio: false })], 't').audio, 'drop');
  });
});
