import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  WEB_FULLSCREEN_WIDE_RATIO,
  normalizeWebVideoSize,
  webFullscreenOrientation,
} from './web-fullscreen-orientation';

test('a wide video turns the phone to landscape', () => {
  assert.equal(webFullscreenOrientation({ width: 1920, height: 1080 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 320, height: 176 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 640, height: 480 }), 'landscape'); // 4:3
  assert.equal(webFullscreenOrientation({ width: 2560, height: 1080 }), 'landscape'); // 21:9
});

test('a tall video keeps the phone portrait', () => {
  assert.equal(webFullscreenOrientation({ width: 1080, height: 1920 }), 'portrait');
  assert.equal(webFullscreenOrientation({ width: 576, height: 1024 }), 'portrait');
  assert.equal(webFullscreenOrientation({ width: 1080, height: 1350 }), 'portrait'); // 4:5
});

test('a square or nearly square video keeps the phone portrait', () => {
  assert.equal(webFullscreenOrientation({ width: 1080, height: 1080 }), 'portrait');
  assert.equal(webFullscreenOrientation({ width: 1080, height: 1078 }), 'portrait');
  assert.equal(webFullscreenOrientation({ width: 1000 * WEB_FULLSCREEN_WIDE_RATIO - 1, height: 1000 }), 'portrait');
  assert.equal(webFullscreenOrientation({ width: 1000 * WEB_FULLSCREEN_WIDE_RATIO, height: 1000 }), 'landscape');
});

test('an unknown size goes to landscape', () => {
  assert.equal(webFullscreenOrientation(null), 'landscape');
  assert.equal(webFullscreenOrientation(undefined), 'landscape');
  assert.equal(webFullscreenOrientation({}), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 1080 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 0, height: 0 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 1080, height: 0 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: -720, height: -1280 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: Number.NaN, height: 720 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: Number.POSITIVE_INFINITY, height: 720 }), 'landscape');
  assert.equal(webFullscreenOrientation({ width: 720, height: 1e9 }), 'landscape');
});

test('normalizeWebVideoSize keeps only usable sizes', () => {
  assert.deepEqual(normalizeWebVideoSize({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(normalizeWebVideoSize({ width: 1280, height: 0 }), null);
  assert.equal(normalizeWebVideoSize({ width: '1280' as unknown as number, height: 720 }), null);
  assert.equal(normalizeWebVideoSize(null), null);
});
