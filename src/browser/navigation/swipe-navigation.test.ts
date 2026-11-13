import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  pageEdgeSwipesAvailable,
  SWIPE_TRIGGER_DP,
  swipeDirection,
  swipeOutcome,
  swipeProgress,
} from './swipe-navigation.ts';

const both = { canGoBack: true, canGoForward: true };

test('finger toward the reading start goes back; mirrored in right-to-left', () => {
  assert.equal(swipeDirection(50, false), 'back');
  assert.equal(swipeDirection(-50, false), 'forward');
  assert.equal(swipeDirection(-50, true), 'back');
  assert.equal(swipeDirection(50, true), 'forward');
  assert.equal(swipeDirection(0, false), null);
});

test('the trigger distance, or a fast fling over half of it', () => {
  assert.equal(swipeOutcome({ dx: SWIPE_TRIGGER_DP - 1, vx: 100, rtl: false, ...both }), null);
  assert.equal(swipeOutcome({ dx: SWIPE_TRIGGER_DP, vx: 0, rtl: false, ...both }), 'back');
  assert.equal(swipeOutcome({ dx: -SWIPE_TRIGGER_DP / 2, vx: -1200, rtl: false, ...both }), 'forward');
  assert.equal(swipeOutcome({ dx: 20, vx: 3000, rtl: false, ...both }), null, 'too short even when fast');
  // A fling back the other way at the end cancels the speed bonus.
  assert.equal(swipeOutcome({ dx: 50, vx: -1500, rtl: false, ...both }), null);
});

test('nothing when there is nowhere to go', () => {
  assert.equal(swipeOutcome({ dx: 200, vx: 0, rtl: false, canGoBack: false, canGoForward: true }), null);
  assert.equal(swipeOutcome({ dx: 200, vx: 0, rtl: true, canGoBack: true, canGoForward: false }), null);
  assert.equal(swipeOutcome({ dx: -200, vx: 0, rtl: true, canGoBack: true, canGoForward: false }), 'back');
});

test('progress for the arrow; page edges only with button navigation', () => {
  assert.equal(swipeProgress(SWIPE_TRIGGER_DP / 2), 0.5);
  assert.equal(swipeProgress(-500), 1);
  assert.equal(swipeProgress(Number.NaN), 0);
  assert.equal(pageEdgeSwipesAvailable('gesture'), false);
  assert.equal(pageEdgeSwipesAvailable('threeButton'), true);
  assert.equal(pageEdgeSwipesAvailable('twoButton'), true);
  assert.equal(pageEdgeSwipesAvailable(undefined), false);
});
