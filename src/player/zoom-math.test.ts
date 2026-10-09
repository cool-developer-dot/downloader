import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  anchoredTranslation,
  clampTranslation,
  fittedContentSize,
  isZoomed,
  MAX_ZOOM,
  maxTranslation,
  MIN_ZOOM,
  parseResolution,
  rubberBandScale,
  rubberBandTranslation,
  settleScale,
  settleTranslation,
} from './zoom-math';

const portraitSurface = { width: 390, height: 300 };

describe('video zoom geometry', () => {
  test('the fitted picture keeps the video aspect ratio', () => {
    assert.deepEqual(fittedContentSize(portraitSurface, { width: 1920, height: 1080 }), {
      width: 390,
      height: 219.375,
    });
    const tall = fittedContentSize({ width: 800, height: 390 }, { width: 720, height: 1280 });
    assert.ok(Math.abs(tall.width / tall.height - 720 / 1280) < 1e-9);
    assert.equal(tall.height, 390);
    // Unknown video size: the whole surface.
    assert.deepEqual(fittedContentSize(portraitSurface, null), portraitSurface);
    assert.deepEqual(fittedContentSize({ width: 0, height: 0 }, { width: 1, height: 1 }), { width: 0, height: 0 });
  });

  test('scale stays between fitted and the maximum once the fingers lift', () => {
    assert.equal(settleScale(0.6), MIN_ZOOM);
    assert.equal(settleScale(1.02), MIN_ZOOM, 'a hair above fitted snaps back');
    assert.equal(settleScale(2.5), 2.5);
    assert.equal(settleScale(9), MAX_ZOOM);
    assert.equal(settleScale(Number.NaN), MIN_ZOOM);
    assert.equal(isZoomed(1), false);
    assert.equal(isZoomed(1.5), true);
  });

  test('pinching past the limits is resisted and bounded', () => {
    assert.equal(rubberBandScale(2), 2);
    const under = rubberBandScale(0.5);
    assert.ok(under < 1 && under >= 0.75);
    const over = rubberBandScale(10);
    assert.ok(over > MAX_ZOOM && over <= MAX_ZOOM * 1.25);
    assert.equal(rubberBandScale(-1), MIN_ZOOM);
  });

  test('translation is clamped so the zoomed picture never leaves a gap', () => {
    const content = fittedContentSize(portraitSurface, { width: 1920, height: 1080 });
    // 2x: 780 x 438.75 in a 390 x 300 surface.
    assert.equal(maxTranslation(portraitSurface.width, content.width, 2), 195);
    assert.equal(maxTranslation(portraitSurface.height, content.height, 2), 69.375);
    // Still smaller than the surface on that axis: centred, no pan.
    assert.equal(maxTranslation(portraitSurface.height, content.height, 1.2), 0);
    assert.equal(clampTranslation(500, 195), 195);
    assert.equal(clampTranslation(-500, 195), -195);
    assert.equal(clampTranslation(Number.NaN, 195), 0);
    assert.deepEqual(settleTranslation({ x: 400, y: -400 }, portraitSurface, content, 2), { x: 195, y: -69.375 });
    assert.deepEqual(settleTranslation({ x: 40, y: 40 }, portraitSurface, content, 1), { x: 0, y: 0 });
  });

  test('dragging past an edge is resisted, not blocked', () => {
    assert.equal(rubberBandTranslation(100, 195), 100);
    const past = rubberBandTranslation(295, 195);
    assert.ok(past > 195 && past < 295);
    const pastNegative = rubberBandTranslation(-295, 195);
    assert.ok(pastNegative < -195 && pastNegative > -295);
  });

  test('the point under the fingers stays under the fingers', () => {
    // Pinch around a point 100 px right of centre, from 1x to 2x, fingers not moving.
    const tx = anchoredTranslation(100, 100, 0, 1, 2);
    // Picture point under the focal before: (100 - 0) / 1 = 100; after: t + s * 100 = -100 + 200 = 100.
    assert.equal(tx, -100);
    assert.equal(tx + 2 * 100, 100);
    // Moving both fingers 30 px pans by 30 px.
    assert.equal(anchoredTranslation(130, 100, 0, 1, 1), 30);
    assert.equal(anchoredTranslation(10, 10, 5, 0, 2), 5, 'a broken start scale changes nothing');
  });

  test('library resolution labels parse into a display size', () => {
    assert.deepEqual(parseResolution('1280x720'), { width: 1280, height: 720 });
    assert.deepEqual(parseResolution(' 720 × 1280 '), { width: 720, height: 1280 });
    assert.equal(parseResolution('720p'), null);
    assert.equal(parseResolution(null), null);
  });
});
