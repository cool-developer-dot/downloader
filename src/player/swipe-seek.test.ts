/**
 * P8 #582 Horizontal Swipe Seek: the target and the change shown while swiping ("12:34 (+0:45)"), clamped to the
 * video, and the indicator's store.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  HIDDEN_SWIPE_SEEK_HUD,
  SWIPE_SEEK_SECONDS_PER_WIDTH,
  createSwipeSeekHud,
  formatSeekDelta,
  formatSwipeSeekLabel,
  swipeSeekTarget,
} from './swipe-seek.ts';

const MINUS = '−';

describe('swipe seek: target and change', () => {
  const at = (startSeconds: number, translationX: number, extra: Partial<Parameters<typeof swipeSeekTarget>[0]> = {}) =>
    swipeSeekTarget({ startSeconds, durationSeconds: 1800, translationX, surfaceWidth: 400, ...extra });

  it('moves 90 seconds for a swipe across the whole picture at Normal; right is forward', () => {
    assert.equal(SWIPE_SEEK_SECONDS_PER_WIDTH, 90);
    assert.deepEqual(at(709, 200), { targetSeconds: 754, deltaSeconds: 45 });
    assert.deepEqual(at(709, 400), { targetSeconds: 799, deltaSeconds: 90 });
    assert.deepEqual(at(709, -200), { targetSeconds: 664, deltaSeconds: -45 });
    assert.deepEqual(at(709, 0), { targetSeconds: 709, deltaSeconds: 0 });
  });

  it('is relative to the picture\'s width (the card and full screen feel the same)', () => {
    assert.deepEqual(at(100, 163, { surfaceWidth: 326 }), { targetSeconds: 145, deltaSeconds: 45 });
    assert.deepEqual(at(100, 400, { surfaceWidth: 800 }), { targetSeconds: 145, deltaSeconds: 45 });
  });

  it('follows the sensitivity: Low half as far, High twice as far', () => {
    assert.deepEqual(at(709, 200, { sensitivity: 'low' }), { targetSeconds: 732, deltaSeconds: 23 });
    assert.deepEqual(at(709, -200, { sensitivity: 'low' }), { targetSeconds: 686, deltaSeconds: -23 });
    assert.deepEqual(at(709, 200, { sensitivity: 'high' }), { targetSeconds: 799, deltaSeconds: 90 });
    assert.deepEqual(at(709, 200, { sensitivity: 'normal' }), at(709, 200));
  });

  it('changes by whole seconds, rounded the same way left and right, so the label and the seek agree', () => {
    const right = at(100.4, 10); // 2.25 s → 2
    const left = at(100.4, -10);
    assert.equal(right?.deltaSeconds, 2);
    assert.equal(left?.deltaSeconds, -2);
    assert.equal(right?.targetSeconds, 102.4);
    assert.ok(Object.is(at(50, -1)?.deltaSeconds, 0)); // −0.225 s → 0, never −0
  });

  it('stays inside 0 … the video\'s length', () => {
    assert.deepEqual(at(1790, 200), { targetSeconds: 1800, deltaSeconds: 10 });
    assert.deepEqual(at(20, -400), { targetSeconds: 0, deltaSeconds: -20 });
    assert.deepEqual(at(1800, 50), { targetSeconds: 1800, deltaSeconds: 0 });
    assert.deepEqual(at(0, -50), { targetSeconds: 0, deltaSeconds: 0 });
    // A start the player reports past either end is taken as that end.
    assert.deepEqual(at(1900, -200), { targetSeconds: 1755, deltaSeconds: -45 });
    assert.deepEqual(at(-3, 200), { targetSeconds: 45, deltaSeconds: 45 });
  });

  it('gives no target without a length, a width or a position', () => {
    assert.equal(at(10, 100, { durationSeconds: null }), null);
    assert.equal(at(10, 100, { durationSeconds: 0 }), null);
    assert.equal(at(10, 100, { durationSeconds: Number.POSITIVE_INFINITY }), null);
    assert.equal(at(10, 100, { surfaceWidth: 0 }), null);
    assert.equal(at(Number.NaN, 100), null);
    assert.deepEqual(at(10, Number.NaN), { targetSeconds: 10, deltaSeconds: 0 });
  });
});

describe('swipe seek: the label', () => {
  it('shows the change with its sign, minutes not padded', () => {
    assert.equal(formatSeekDelta(45), '+0:45');
    assert.equal(formatSeekDelta(-65), `${MINUS}1:05`);
    assert.equal(formatSeekDelta(3723), '+1:02:03');
    assert.equal(formatSeekDelta(-3600), `${MINUS}1:00:00`);
    assert.equal(formatSeekDelta(0), '+0:00');
    assert.equal(formatSeekDelta(-0.4), '+0:00');
    assert.equal(formatSeekDelta(Number.NaN), '+0:00');
  });

  it('reads "12:34 (+0:45)"', () => {
    assert.equal(formatSwipeSeekLabel({ targetSeconds: 754, deltaSeconds: 45 }), '12:34 (+0:45)');
    assert.equal(formatSwipeSeekLabel({ targetSeconds: 664, deltaSeconds: -45 }), `11:04 (${MINUS}0:45)`);
    assert.equal(formatSwipeSeekLabel({ targetSeconds: 3725, deltaSeconds: 90 }), '1:02:05 (+1:30)');
  });
});

describe('swipe seek: the indicator store', () => {
  it('notifies on a change only, and hides', () => {
    const hud = createSwipeSeekHud();
    let calls = 0;
    const unsubscribe = hud.subscribe(() => {
      calls += 1;
    });
    assert.deepEqual(hud.getSnapshot(), HIDDEN_SWIPE_SEEK_HUD);
    hud.show({ targetSeconds: 754, deltaSeconds: 45 });
    hud.show({ targetSeconds: 754, deltaSeconds: 45 });
    assert.equal(calls, 1);
    assert.deepEqual(hud.getSnapshot(), { visible: true, targetSeconds: 754, deltaSeconds: 45 });
    hud.show({ targetSeconds: 755, deltaSeconds: 46 });
    hud.hide();
    hud.hide();
    assert.equal(calls, 3);
    assert.equal(hud.getSnapshot().visible, false);
    unsubscribe();
    hud.show({ targetSeconds: 1, deltaSeconds: 1 });
    assert.equal(calls, 3);
    hud.dispose();
    assert.deepEqual(hud.getSnapshot(), HIDDEN_SWIPE_SEEK_HUD);
  });
});
