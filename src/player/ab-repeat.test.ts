import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AB_LOOP_LEAD_SECONDS,
  MIN_AB_LOOP_SECONDS,
  NO_AB_POINTS,
  abLoopJumpTarget,
  abLoopOf,
  abMarkerFractions,
  abTileStep,
  clampToVideo,
  setAbPointA,
  setAbPointB,
} from './ab-repeat';

describe('A-B repeat points (#541)', () => {
  test('A then B makes a loop', () => {
    const a = setAbPointA(NO_AB_POINTS, 10, 120);
    assert.ok(a.ok);
    const b = setAbPointB(a.points, 25, 120);
    assert.ok(b.ok);
    assert.deepEqual(b.points, { a: 10, b: 25 });
    assert.deepEqual(abLoopOf(b.points, 120), { startSeconds: 10, endSeconds: 25 });
  });

  test('B before A is swapped, so the loop always runs forwards', () => {
    const a = setAbPointA(NO_AB_POINTS, 40, 120);
    assert.ok(a.ok);
    const b = setAbPointB(a.points, 15, 120);
    assert.ok(b.ok);
    assert.deepEqual(b.points, { a: 15, b: 40 });
    // Stored the other way round (an old state, or B set first): the loop is still forwards.
    assert.deepEqual(abLoopOf({ a: 40, b: 15 }, 120), { startSeconds: 15, endSeconds: 40 });
    // B first, then A after it.
    const bFirst = setAbPointB(NO_AB_POINTS, 30, 120);
    assert.ok(bFirst.ok);
    const thenA = setAbPointA(bFirst.points, 50, 120);
    assert.ok(thenA.ok);
    assert.deepEqual(thenA.points, { a: 30, b: 50 });
  });

  test('B past the end is moved to the end; a point before 0 to 0', () => {
    const b = setAbPointB({ a: 100, b: null }, 500, 118.5);
    assert.ok(b.ok);
    assert.deepEqual(b.points, { a: 100, b: 118.5 });
    assert.deepEqual(abLoopOf({ a: -3, b: 999 }, 60), { startSeconds: 0, endSeconds: 60 });
    // Duration not known yet: kept as given (never below 0).
    assert.equal(clampToVideo(500, null), 500);
    assert.equal(clampToVideo(-1, null), 0);
    assert.equal(clampToVideo(Number.NaN, 60), 0);
  });

  test('a loop shorter than half a second is refused, and changes nothing', () => {
    const near = setAbPointB({ a: 10, b: null }, 10 + MIN_AB_LOOP_SECONDS / 2, 60);
    assert.deepEqual(near, { ok: false, reason: 'tooShort' });
    assert.deepEqual(setAbPointA({ a: null, b: 20 }, 19.8, 60), { ok: false, reason: 'tooShort' });
    assert.ok(setAbPointB({ a: 10, b: null }, 10 + MIN_AB_LOOP_SECONDS, 60).ok);
    // Both past the end become the same point: no loop.
    assert.equal(abLoopOf({ a: 70, b: 90 }, 60), null);
    assert.equal(abLoopOf({ a: 10, b: null }, 60), null);
  });

  test('playing into B jumps back to A; before A and inside the loop it plays on', () => {
    const loop = { startSeconds: 10, endSeconds: 25 };
    assert.equal(abLoopJumpTarget(loop, 5), null, 'before A: plays into the loop');
    assert.equal(abLoopJumpTarget(loop, 10), null);
    assert.equal(abLoopJumpTarget(loop, 24.9), null);
    assert.equal(abLoopJumpTarget(loop, 25 - AB_LOOP_LEAD_SECONDS), 10, 'at B');
    assert.equal(abLoopJumpTarget(loop, 80), 10, 'seeked past B');
    assert.equal(abLoopJumpTarget(null, 80), null);
    assert.equal(abLoopJumpTarget(loop, Number.NaN), null);
  });

  test('the tile sets A, then B, then opens the sheet', () => {
    assert.equal(abTileStep(NO_AB_POINTS), 'setA');
    assert.equal(abTileStep({ a: 3, b: null }), 'setB');
    assert.equal(abTileStep({ a: 3, b: 9 }), 'openSheet');
  });

  test('markers sit at fractions of the timeline', () => {
    assert.deepEqual(abMarkerFractions({ a: 30, b: 90 }, 120), { a: 0.25, b: 0.75 });
    assert.deepEqual(abMarkerFractions({ a: 30, b: 200 }, 120), { a: 0.25, b: 1 });
    assert.deepEqual(abMarkerFractions({ a: 30, b: null }, null), { a: null, b: null });
  });
});
