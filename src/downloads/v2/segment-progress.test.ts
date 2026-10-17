import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  applyProgressSample,
  EMPTY_PROGRESS_STATS,
  markInactive,
  segmentCounts,
  type ProgressSampleInput,
} from './progress-stats';
import {
  getProgressStats,
  recordProgressEvent,
  recordStateEvent,
  resetProgressStatsForTests,
} from './progress-stats-store';

afterEach(() => resetProgressStatsForTests());

function sample(at: number, extra: Partial<ProgressSampleInput> = {}): ProgressSampleInput {
  return { at, phase: 'download', bytesDone: at, speedBps: 1000, ...extra };
}

describe('segment progress (#315)', () => {
  test('valid counts are kept as reported', () => {
    assert.deepEqual(segmentCounts(0, 340), { done: 0, total: 340 });
    assert.deepEqual(segmentCounts(12, 340), { done: 12, total: 340 });
    assert.deepEqual(segmentCounts(340, 340), { done: 340, total: 340 });
  });

  test('missing, partial or impossible counts are unknown, never shown', () => {
    const bad: [unknown, unknown][] = [
      [undefined, undefined],
      [null, null],
      [5, undefined],
      [undefined, 10],
      [5, 0],
      [-1, 10],
      [11, 10],
      [1.5, 10],
      [1, 10.5],
      [NaN, 10],
      [1, Infinity],
      ['3', '10'],
    ];
    for (const [done, total] of bad) {
      assert.equal(segmentCounts(done, total), null, `${String(done)}/${String(total)}`);
    }
  });

  test('a segment download follows its newest counts', () => {
    let stats = applyProgressSample(EMPTY_PROGRESS_STATS, sample(0, { segmentsDone: 0, segmentsTotal: 3 }));
    stats = applyProgressSample(stats, sample(250, { segmentsDone: 1, segmentsTotal: 3 }));
    assert.deepEqual(stats.segments, { done: 1, total: 3 });
    // Re-read playlists can change the total: the newest report wins.
    stats = applyProgressSample(stats, sample(500, { segmentsDone: 2, segmentsTotal: 4 }));
    assert.deepEqual(stats.segments, { done: 2, total: 4 });
  });

  test('an event without counts (file download, older native build) changes nothing: today\'s behaviour', () => {
    const file = applyProgressSample(EMPTY_PROGRESS_STATS, sample(0));
    assert.equal(file.segments, null);
    const stream = applyProgressSample(EMPTY_PROGRESS_STATS, sample(0, { segmentsDone: 2, segmentsTotal: 9 }));
    assert.deepEqual(applyProgressSample(stream, sample(250)).segments, { done: 2, total: 9 });
    assert.deepEqual(
      applyProgressSample(stream, sample(250, { segmentsDone: 99, segmentsTotal: 9 })).segments,
      { done: 2, total: 9 },
      'an impossible report keeps the last good one',
    );
  });

  test('pausing keeps the last counts on screen', () => {
    const stream = applyProgressSample(EMPTY_PROGRESS_STATS, sample(0, { segmentsDone: 5, segmentsTotal: 9 }));
    assert.deepEqual(markInactive(stream).segments, { done: 5, total: 9 });
    const processing = applyProgressSample(stream, { at: 300, phase: 'processing', bytesDone: 0, speedBps: 0 });
    assert.deepEqual(processing.segments, { done: 5, total: 9 });
  });

  test('the store keeps them per download and drops them with a finished download', () => {
    recordProgressEvent({ id: 'hls', phase: 'download', bytesDone: 10, speedBps: 5, segmentsDone: 3, segmentsTotal: 8 }, 0);
    recordProgressEvent({ id: 'file', phase: 'download', bytesDone: 10, speedBps: 5 }, 0);
    assert.deepEqual(getProgressStats('hls')?.segments, { done: 3, total: 8 });
    assert.equal(getProgressStats('file')?.segments, null);

    recordStateEvent('hls', 'paused');
    assert.deepEqual(getProgressStats('hls')?.segments, { done: 3, total: 8 });
    recordStateEvent('hls', 'completed');
    assert.equal(getProgressStats('hls'), null);
  });
});
