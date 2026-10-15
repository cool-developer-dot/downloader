import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CARD_GAP,
  CARD_MAX_WIDTH,
  CARD_SCREEN_MARGIN,
  isUsableRect,
  MIN_CARD_SPACE,
  placeCard,
  spotlightPath,
  spotlightRect,
  videoBarRect,
} from './tour-layout.ts';

const PIXEL_8 = { width: 412, height: 915 };
const SMALL = { width: 360, height: 640 };
const INSETS = { top: 24, bottom: 24 };

test('missing or off-screen targets are not usable', () => {
  assert.equal(isUsableRect(null, PIXEL_8), false);
  assert.equal(isUsableRect({ x: 0, y: 0, width: 0, height: 0 }, PIXEL_8), false);
  assert.equal(isUsableRect({ x: Number.NaN, y: 0, width: 10, height: 10 }, PIXEL_8), false);
  assert.equal(isUsableRect({ x: 0, y: 2000, width: 100, height: 40 }, PIXEL_8), false);
  assert.equal(isUsableRect({ x: -500, y: 10, width: 100, height: 40 }, PIXEL_8), false);
  assert.equal(isUsableRect({ x: 12, y: 40, width: 300, height: 44 }, PIXEL_8), true);
});

test('the spotlight pads the target and stays on screen', () => {
  assert.deepEqual(spotlightRect({ x: 10, y: 50, width: 100, height: 40 }, PIXEL_8, 6), {
    x: 4,
    y: 44,
    width: 112,
    height: 52,
  });
  const edge = spotlightRect({ x: 0, y: 870, width: 412, height: 45 }, PIXEL_8, 6);
  assert.deepEqual(edge, { x: 0, y: 864, width: 412, height: 51 });
});

test('the Video available example sits at the bottom of the page area', () => {
  assert.deepEqual(videoBarRect({ x: 0, y: 100, width: 412, height: 600 }, 48), { x: 0, y: 652, width: 412, height: 48 });
  assert.deepEqual(videoBarRect({ x: 0, y: 100, width: 412, height: 30 }, 48), { x: 0, y: 100, width: 412, height: 30 });
});

test('a target near the top gets its card below; a tab at the bottom gets it above', () => {
  const addressBar = spotlightRect({ x: 60, y: 40, width: 290, height: 44 }, PIXEL_8);
  const below = placeCard(addressBar, PIXEL_8, INSETS);
  assert.equal(below.side, 'below');
  assert.equal(below.top, Math.round(addressBar.y + addressBar.height + CARD_GAP));
  assert.ok(below.maxHeight >= MIN_CARD_SPACE);

  const settingsTab = spotlightRect({ x: 309, y: 850, width: 103, height: 65 }, PIXEL_8);
  const above = placeCard(settingsTab, PIXEL_8, INSETS);
  assert.equal(above.side, 'above');
  assert.equal(above.bottom, Math.round(PIXEL_8.height - (settingsTab.y - CARD_GAP)));
  // The pointer follows the tab, kept off the card's rounded corners.
  assert.ok(above.caretX !== null && above.caretX > above.width / 2);
  assert.ok(above.caretX !== null && above.caretX <= above.width - 28);
});

test('the card is centred, never wider than the screen margins or the max width', () => {
  const phone = placeCard({ x: 0, y: 40, width: 100, height: 40 }, SMALL, INSETS);
  assert.equal(phone.width, SMALL.width - 2 * CARD_SCREEN_MARGIN);
  assert.equal(phone.left, CARD_SCREEN_MARGIN);
  const tablet = placeCard({ x: 0, y: 40, width: 100, height: 40 }, { width: 1000, height: 1400 }, INSETS);
  assert.equal(tablet.width, CARD_MAX_WIDTH);
  assert.equal(tablet.left, (1000 - CARD_MAX_WIDTH) / 2);
});

test('a target filling the screen: the card overlays the emptier half, scrollable, no pointer', () => {
  const big = { x: 0, y: 120, width: 360, height: 420 };
  const placement = placeCard(big, SMALL, INSETS);
  assert.equal(placement.side, 'overlay');
  assert.equal(placement.caretX, null);
  assert.ok(placement.maxHeight > 0 && placement.maxHeight <= SMALL.height * 0.6);
  // Card height is always bounded by the screen, whatever the font scale.
  for (const y of [0, 100, 300, 500, 600]) {
    const p = placeCard({ x: 0, y, width: 360, height: 40 }, SMALL, INSETS);
    assert.ok(p.maxHeight <= SMALL.height - INSETS.top - INSETS.bottom - 2 * CARD_SCREEN_MARGIN, `y=${y}`);
  }
});

test('the dim path cuts a rounded hole (even-odd)', () => {
  const path = spotlightPath({ width: 100, height: 200 }, { x: 10, y: 20, width: 50, height: 30 }, 8);
  assert.ok(path.startsWith('M0 0H100V200H0Z'));
  assert.ok(path.includes('M18 20H52A8 8 0 0 1 60 28'));
  assert.equal(spotlightPath({ width: 100, height: 200 }, { x: 0, y: 0, width: 0, height: 0 }, 8), 'M0 0H100V200H0Z');
});
