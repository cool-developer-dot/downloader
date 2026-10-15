import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyProgressSample,
  averageSpeedBps,
  elapsedActiveMs,
  EMPTY_PROGRESS_STATS,
  formatElapsed,
  GRAPH_WINDOW_MS,
  markInactive,
  MAX_ACTIVE_GAP_MS,
  remainingBytes,
  speedGraphPoints,
  totalSpeedBps,
  type ProgressStats,
} from './progress-stats';

function feed(stats: ProgressStats, events: [at: number, bytes: number, speed?: number][]): ProgressStats {
  return events.reduce(
    (acc, [at, bytesDone, speedBps = 1000]) => applyProgressSample(acc, { at, phase: 'download', bytesDone, speedBps }),
    stats,
  );
}

function assertSane(value: number | null): void {
  if (value != null) {
    assert.ok(Number.isFinite(value) && value >= 0, `not a sane value: ${value}`);
  }
}

describe('remainingBytes', () => {
  test('total minus done when the total is known', () => {
    assert.equal(remainingBytes(300, 1000), 700);
    assert.equal(remainingBytes(1000, 1000), 0);
  });

  test('unknown when the total is unknown, zero, or behind the bytes', () => {
    for (const [done, total] of [[10, null], [10, undefined], [10, 0], [2000, 1000], [NaN, 100], [10, Infinity],
      [-5, 100], [10, -1]] as [number, number][]) {
      assert.equal(remainingBytes(done, total), null, `${done}/${total}`);
    }
  });
});

describe('active time and average speed', () => {
  test('consecutive events accumulate time and bytes', () => {
    const stats = feed(EMPTY_PROGRESS_STATS, [[0, 0], [250, 1000], [500, 2000], [1000, 4000]]);
    assert.equal(stats.activeMs, 1000);
    assert.equal(stats.activeBytes, 4000);
    assert.equal(elapsedActiveMs(stats), 1000);
    assert.equal(averageSpeedBps(stats), 4000);
  });

  test('a paused stretch is excluded', () => {
    let stats = feed(EMPTY_PROGRESS_STATS, [[0, 0], [1000, 1000]]);
    stats = markInactive(stats); // paused
    stats = feed(stats, [[60_000, 1000], [61_000, 3000]]); // resumed a minute later
    assert.equal(stats.activeMs, 2000);
    assert.equal(stats.activeBytes, 3000);
    assert.equal(averageSpeedBps(stats), 1500);
  });

  test('a gap longer than the limit is not counted (the app did not see it)', () => {
    const stats = feed(EMPTY_PROGRESS_STATS, [[0, 0], [1000, 1000], [1000 + MAX_ACTIVE_GAP_MS + 1, 50_000],
      [2001 + MAX_ACTIVE_GAP_MS, 51_000]]);
    assert.equal(stats.activeMs, 2000);
    assert.equal(stats.activeBytes, 2000);
  });

  test('processing ends the stretch', () => {
    let stats = feed(EMPTY_PROGRESS_STATS, [[0, 0], [1000, 1000]]);
    stats = applyProgressSample(stats, { at: 1500, phase: 'processing', bytesDone: 1000, speedBps: 0 });
    assert.equal(stats.lastAt, null);
    stats = feed(stats, [[2000, 1000]]);
    assert.equal(stats.activeMs, 1000);
  });

  test('a restart from zero is never negative progress', () => {
    const stats = feed(EMPTY_PROGRESS_STATS, [[0, 5000], [1000, 6000], [1250, 0], [2250, 1000]]);
    assert.equal(stats.activeBytes, 2000);
    assert.equal(stats.activeMs, 2000);
  });

  test('unknown until a second of activity was seen', () => {
    assert.equal(averageSpeedBps(EMPTY_PROGRESS_STATS), null);
    assert.equal(elapsedActiveMs(EMPTY_PROGRESS_STATS), null);
    const short = feed(EMPTY_PROGRESS_STATS, [[0, 0], [500, 100]]);
    assert.equal(averageSpeedBps(short), null);
    assert.equal(elapsedActiveMs(short), null);
    assert.equal(averageSpeedBps(null), null);
  });

  test('time without bytes gives elapsed time but no average speed', () => {
    const stalled = feed(EMPTY_PROGRESS_STATS, [[0, 100], [1000, 100], [2000, 100]]);
    assert.equal(elapsedActiveMs(stalled), 2000);
    assert.equal(averageSpeedBps(stalled), null);
  });

  test('garbage input never produces NaN, Infinity or negatives', () => {
    let stats = EMPTY_PROGRESS_STATS;
    for (const [at, bytes, speed] of [[NaN, 1, 1], [0, NaN, NaN], [100, Infinity, -1], [200, -10, Infinity],
      [300, 10, 5], [300, 20, 5], [-1, 30, 5]] as [number, number, number][]) {
      stats = applyProgressSample(stats, { at, phase: 'download', bytesDone: bytes, speedBps: speed });
      assertSane(stats.activeMs);
      assertSane(stats.activeBytes);
      assertSane(averageSpeedBps(stats));
      assertSane(elapsedActiveMs(stats));
    }
    for (const sample of stats.samples) {
      assertSane(sample.bps);
    }
  });
});

describe('speedGraphPoints', () => {
  test('one value per second over the last minute, newest last', () => {
    const stats = feed(EMPTY_PROGRESS_STATS, [[100_000, 0, 1000], [101_000, 1000, 2000], [102_000, 3000, 4000]]);
    const graph = speedGraphPoints(stats, 102_000);
    assert.ok(graph);
    assert.equal(graph.points.length, 60);
    assert.deepEqual(graph.points.slice(-3), [1000, 2000, 4000]);
    assert.equal(graph.maxBps, 4000);
  });

  test('samples older than the window are dropped', () => {
    const stats = feed(EMPTY_PROGRESS_STATS, [[0, 0, 9999], [GRAPH_WINDOW_MS + 5000, 10, 100],
      [GRAPH_WINDOW_MS + 6000, 20, 200]]);
    assert.ok(stats.samples.every((s) => s.bps !== 9999));
    const graph = speedGraphPoints(stats, GRAPH_WINDOW_MS + 6000);
    assert.equal(graph?.maxBps, 200);
  });

  test('hidden with fewer than two samples or no speed at all', () => {
    assert.equal(speedGraphPoints(EMPTY_PROGRESS_STATS, 1000), null);
    assert.equal(speedGraphPoints(feed(EMPTY_PROGRESS_STATS, [[0, 0]]), 0), null);
    assert.equal(speedGraphPoints(feed(EMPTY_PROGRESS_STATS, [[0, 0, 0], [1000, 0, 0]]), 1000), null);
    assert.equal(speedGraphPoints(null, 1000), null);
  });
});

describe('totalSpeedBps', () => {
  test('sums only running downloads with a known speed', () => {
    assert.equal(
      totalSpeedBps([
        { status: 'DOWNLOADING', bytesPerSecond: 1000 },
        { status: 'DOWNLOADING', bytesPerSecond: 500 },
        { status: 'DOWNLOADING', bytesPerSecond: null },
        { status: 'PAUSED', bytesPerSecond: 9999 },
        { status: 'QUEUED', bytesPerSecond: 9999 },
      ]),
      1500,
    );
  });

  test('unknown when nothing runs or no speed is known; garbage is ignored', () => {
    assert.equal(totalSpeedBps([]), null);
    assert.equal(totalSpeedBps([{ status: 'PAUSED', bytesPerSecond: 10 }]), null);
    assert.equal(totalSpeedBps([{ status: 'DOWNLOADING', bytesPerSecond: undefined }]), null);
    assert.equal(
      totalSpeedBps([
        { status: 'DOWNLOADING', bytesPerSecond: NaN },
        { status: 'DOWNLOADING', bytesPerSecond: -5 },
        { status: 'DOWNLOADING', bytesPerSecond: Infinity },
        { status: 'DOWNLOADING', bytesPerSecond: 0 },
      ]),
      0,
    );
  });
});

describe('formatElapsed', () => {
  test('clock style', () => {
    assert.equal(formatElapsed(1000), '0:01');
    assert.equal(formatElapsed(65_000), '1:05');
    assert.equal(formatElapsed(3_725_000), '1:02:05');
  });

  test('unknown values are hidden', () => {
    for (const value of [null, undefined, NaN, Infinity, -1000, 0, 999]) {
      assert.equal(formatElapsed(value), null, String(value));
    }
  });
});
