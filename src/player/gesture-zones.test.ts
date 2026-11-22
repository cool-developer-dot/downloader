/**
 * The video surface's zones (left edge brightness, middle, right edge volume) and P8's axis lock: a one-finger swipe
 * is vertical (brightness / volume, as before P8) or horizontal (swipe seek) by its first clear movement.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SIDE_SWIPE_ACTIVE_OFFSET_Y,
  SIDE_SWIPE_FAIL_OFFSET_X,
  SIDE_ZONE_RATIO,
  SWIPE_SEEK_ACTIVE_OFFSET_X,
  SWIPE_SEEK_FAIL_OFFSET_Y,
  lockSwipeAxis,
  resolveSideGestureZone,
  resolveSwipeAxis,
  sideZoneStyle,
} from './gesture-zones.ts';

describe('gesture zones: hit-testing', () => {
  const width = 400; // edges: 0–100 brightness, 300–400 volume

  it('gives the outer quarters to brightness (left) and volume (right), the middle half to the rest', () => {
    assert.equal(SIDE_ZONE_RATIO, 0.25);
    assert.equal(resolveSideGestureZone(0, width), 'brightness');
    assert.equal(resolveSideGestureZone(99.9, width), 'brightness');
    assert.equal(resolveSideGestureZone(200, width), 'center');
    assert.equal(resolveSideGestureZone(300.1, width), 'volume');
    assert.equal(resolveSideGestureZone(400, width), 'volume');
  });

  it('puts the exact quarter lines in the middle', () => {
    assert.equal(resolveSideGestureZone(100, width), 'center');
    assert.equal(resolveSideGestureZone(300, width), 'center');
  });

  it('knows nothing without a usable geometry', () => {
    assert.equal(resolveSideGestureZone(10, 0), null);
    assert.equal(resolveSideGestureZone(10, -1), null);
    assert.equal(resolveSideGestureZone(Number.NaN, width), null);
    assert.equal(resolveSideGestureZone(10, Number.POSITIVE_INFINITY), null);
  });

  it('draws the zones where they hit', () => {
    assert.deepEqual(sideZoneStyle('brightness'), { left: '0%', width: '25%' });
    assert.deepEqual(sideZoneStyle('center'), { left: '25%', width: '50%' });
    assert.deepEqual(sideZoneStyle('volume'), { left: '75%', width: '25%' });
  });
});

describe('gesture zones: the axis lock (P8 #582)', () => {
  it('keeps the edge swipes on the numbers they always had (10 dp up / down to start, 16 dp sideways to give up)', () => {
    assert.equal(SIDE_SWIPE_ACTIVE_OFFSET_Y, 10);
    assert.equal(SIDE_SWIPE_FAIL_OFFSET_X, 16);
  });

  it('gives swipe seek the same two numbers the other way round, so the two can never both start', () => {
    assert.equal(SWIPE_SEEK_ACTIVE_OFFSET_X, SIDE_SWIPE_FAIL_OFFSET_X);
    assert.equal(SWIPE_SEEK_FAIL_OFFSET_Y, SIDE_SWIPE_ACTIVE_OFFSET_Y);
    // A finger held still for 2× (#545) gives up after 12 dp: before swipe seek can start.
    assert.ok(SWIPE_SEEK_ACTIVE_OFFSET_X > 12);
  });

  it('decides nothing until a threshold is passed (it must be passed, not reached)', () => {
    assert.equal(resolveSwipeAxis(0, 0), null);
    assert.equal(resolveSwipeAxis(16, 10), null);
    assert.equal(resolveSwipeAxis(-16, -10), null);
  });

  it('locks to vertical after 10 dp up or down, to horizontal after 16 dp sideways, either way round', () => {
    assert.equal(resolveSwipeAxis(0, 10.5), 'vertical');
    assert.equal(resolveSwipeAxis(15, -11), 'vertical');
    assert.equal(resolveSwipeAxis(16.5, 0), 'horizontal');
    assert.equal(resolveSwipeAxis(-17, 9), 'horizontal');
  });

  it('starts neither when both are passed in the same movement (the edge swipes already ignored that)', () => {
    assert.equal(resolveSwipeAxis(17, 11), 'neither');
    assert.equal(resolveSwipeAxis(-40, 40), 'neither');
  });

  it('ignores broken numbers', () => {
    assert.equal(resolveSwipeAxis(Number.NaN, 30), null);
    assert.equal(resolveSwipeAxis(30, Number.POSITIVE_INFINITY), null);
  });

  it('keeps the first decision of a whole movement', () => {
    // A slightly diagonal swipe on the left edge: brightness, exactly as before P8 (it never reaches 16 dp sideways
    // before 10 dp down).
    assert.equal(lockSwipeAxis([{ dx: 3, dy: 4 }, { dx: 6, dy: 8 }, { dx: 9, dy: 11 }, { dx: 30, dy: 40 }]), 'vertical');
    // Mostly sideways: swipe seek, even if it drifts down afterwards.
    assert.equal(lockSwipeAxis([{ dx: 5, dy: 2 }, { dx: 12, dy: 6 }, { dx: 17, dy: 9 }, { dx: 60, dy: 30 }]), 'horizontal');
    // A fast diagonal flick that passes both in one movement: nothing.
    assert.equal(lockSwipeAxis([{ dx: 4, dy: 3 }, { dx: 20, dy: 14 }]), 'neither');
    // A tap.
    assert.equal(lockSwipeAxis([{ dx: 1, dy: 1 }]), null);
    assert.equal(lockSwipeAxis([]), null);
  });
});
