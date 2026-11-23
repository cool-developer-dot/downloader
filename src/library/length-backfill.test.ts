import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  LENGTH_BACKFILL_BATCH,
  LENGTH_RECHECK_MS,
  isBackfillCandidate,
  knownSecondsFromChecked,
  lengthBackfillBatches,
  lengthBackfillQueue,
  type LengthBackfillInput,
} from './length-backfill';

const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const input = (overrides: Partial<LengthBackfillInput> = {}): LengthBackfillInput => ({
  ids: [],
  known: {},
  checked: {},
  asked: new Set(),
  nowMs: NOW,
  ...overrides,
});

describe('length backfill (#711)', () => {
  test('measures library videos with no length, in the order shown, once each', () => {
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['a', 'b', 'a', ' c '] })), ['a', 'b', 'c']);
  });

  test('never sends gallery videos or empty ids', () => {
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['device:12', '', '  ', 'a'] })), ['a']);
    assert.equal(isBackfillCandidate('device:1'), false);
    assert.equal(isBackfillCandidate('dl-1'), true);
  });

  test('skips videos whose length is known from any source, or measured before', () => {
    const queue = lengthBackfillQueue(
      input({
        ids: ['known', 'measured', 'zero', 'new'],
        known: { known: 61, zero: 0 },
        checked: { measured: { durationMs: 90_000, checkedAt: iso(NOW - 1000) } },
      }),
    );
    assert.deepEqual(queue, ['zero', 'new']);
  });

  test('an unreadable video is left alone for a week, then tried again', () => {
    const recently = { bad: { durationMs: null, checkedAt: iso(NOW - LENGTH_RECHECK_MS + 60_000) } };
    const longAgo = { bad: { durationMs: null, checkedAt: iso(NOW - LENGTH_RECHECK_MS - 60_000) } };
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['bad'], checked: recently })), []);
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['bad'], checked: longAgo })), ['bad']);
    // A damaged time: tried again rather than never.
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['bad'], checked: { bad: { durationMs: null, checkedAt: 'x' } } })), [
      'bad',
    ]);
  });

  test('ids already handed out in this run are not sent twice', () => {
    assert.deepEqual(lengthBackfillQueue(input({ ids: ['a', 'b'], asked: new Set(['a']) })), ['b']);
  });

  test('a few at a time', () => {
    const queue = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const batches = lengthBackfillBatches(queue);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [LENGTH_BACKFILL_BATCH, LENGTH_BACKFILL_BATCH, 2],
    );
    assert.deepEqual(batches.flat(), queue);
    assert.deepEqual(lengthBackfillBatches([], 5), []);
    assert.deepEqual(lengthBackfillBatches(['a', 'b'], 0), [['a'], ['b']]);
  });

  test('stored lengths become the Library’s seconds; unreadable ones stay unknown', () => {
    assert.deepEqual(
      knownSecondsFromChecked({
        a: { durationMs: 61_500, checkedAt: iso(NOW) },
        b: { durationMs: null, checkedAt: iso(NOW) },
      }),
      { a: 61.5 },
    );
  });
});
