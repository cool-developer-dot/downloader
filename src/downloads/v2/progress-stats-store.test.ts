import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  getProgressStats,
  recordProgressEvent,
  recordStateEvent,
  resetProgressStatsForTests,
} from './progress-stats-store';
import { averageSpeedBps, elapsedActiveMs } from './progress-stats';

afterEach(() => resetProgressStatsForTests());

function progress(id: string, at: number, bytesDone: number, phase: 'download' | 'processing' = 'download'): void {
  recordProgressEvent({ id, phase, bytesDone, speedBps: 1000 }, at);
}

describe('progress stats store', () => {
  test('progress events accumulate per download', () => {
    progress('a', 0, 0);
    progress('a', 1000, 2000);
    progress('b', 0, 0);
    assert.equal(elapsedActiveMs(getProgressStats('a')), 1000);
    assert.equal(averageSpeedBps(getProgressStats('a')), 2000);
    assert.equal(elapsedActiveMs(getProgressStats('b')), null);
    assert.equal(getProgressStats('missing'), null);
  });

  test('a paused or waiting state ends the active stretch', () => {
    progress('a', 0, 0);
    progress('a', 1000, 1000);
    recordStateEvent('a', 'paused');
    progress('a', 30_000, 1000);
    progress('a', 31_000, 2000);
    assert.equal(elapsedActiveMs(getProgressStats('a')), 2000);

    recordStateEvent('a', 'waiting_network');
    assert.equal(getProgressStats('a')?.lastAt, null);
  });

  test('finished, failed and cancelled downloads are forgotten', () => {
    for (const state of ['completed', 'failed', 'cancelled'] as const) {
      progress('a', 0, 0);
      recordStateEvent('a', state);
      assert.equal(getProgressStats('a'), null, state);
    }
  });

  test('a state event for an unknown download is ignored', () => {
    recordStateEvent('nobody', 'paused');
    assert.equal(getProgressStats('nobody'), null);
  });
});
