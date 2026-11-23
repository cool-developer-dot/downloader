/**
 * P1 — screen 19, the Video player page: the card's size and the chip / tile / menu mapping.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { videoPlayerEn } from '../../../localization/catalogs/videoPlayer.en.ts';
import { videoPlayerUr } from '../../../localization/catalogs/videoPlayer.ur.ts';

import { CARD_DESIGN_RATIO, playerCardSize } from './card-size.ts';
import { NOT_YET_ACTIONS, PAGE_CHIP_FLAGS, PAGE_CHIPS, PAGE_TILES, shownPageChips } from './player-page-actions.ts';

describe('video card size', () => {
  it('is the design card (326 × 169) on the design screen when the picture is unknown or wide', () => {
    assert.deepEqual(playerCardSize(326, null), { width: 326, height: 169 });
    assert.deepEqual(playerCardSize(326, { width: 2400, height: 1000 }), { width: 326, height: 169 });
    assert.equal(CARD_DESIGN_RATIO, 169 / 326);
  });

  it('grows to fit a 16:9 picture without bars, and stops at a square for portrait video', () => {
    assert.deepEqual(playerCardSize(326, { width: 1920, height: 1080 }), { width: 326, height: 183 });
    assert.deepEqual(playerCardSize(326, { width: 1080, height: 1920 }), { width: 326, height: 326 });
  });

  it('copes with nothing to draw in', () => {
    assert.deepEqual(playerCardSize(0, { width: 1920, height: 1080 }), { width: 0, height: 0 });
    assert.deepEqual(playerCardSize(-20, null), { width: 0, height: 0 });
    assert.deepEqual(playerCardSize(326, { width: 0, height: 0 }), { width: 326, height: 169 });
  });
});

describe('screen 19 mapping', () => {
  it('draws the chips and tiles in the design order, with the design icons', () => {
    assert.deepEqual([...PAGE_CHIPS], ['speed', 'subs', 'audio', 'rotate', 'lock']);
    assert.deepEqual(
      PAGE_TILES.map((tile) => [tile.id, tile.icon]),
      [
        ['skipBack', 'rewind'],
        ['customSeek', 'fast-forward'],
        ['frameByFrame', 'film'],
        ['abRepeat', 'repeat'],
        ['aspectRatio', 'sliders-vertical'],
        ['mirrorFlip', 'flip-horizontal-2'],
      ],
    );
  });

  it('hides the Audio chip until P17 and leaves the others, 1.0× included, in the design order', () => {
    assert.equal(PAGE_CHIP_FLAGS.audio, false);
    assert.deepEqual(shownPageChips(), ['speed', 'subs', 'rotate', 'lock']);
    assert.deepEqual(shownPageChips({ ...PAGE_CHIP_FLAGS, audio: true }), ['speed', 'subs', 'audio', 'rotate', 'lock']);
  });

  it('gives P1 its tiles: 10 s skips back, Custom seek sets the interval, Frame by frame opens the panel', () => {
    const byId = Object.fromEntries(PAGE_TILES.map((tile) => [tile.id, tile.action]));
    assert.equal(byId.skipBack, 'skipBack');
    assert.equal(byId.customSeek, 'seekInterval');
    assert.equal(byId.frameByFrame, 'frameByFrame');
  });

  it("gives P2 its tiles: Aspect ratio opens the fit sheet, Filters' place is Mirror / Flip", () => {
    const byId = Object.fromEntries(PAGE_TILES.map((tile) => [tile.id, tile.action]));
    assert.equal(byId.aspectRatio, 'aspectRatio');
    assert.equal(byId.mirrorFlip, 'mirrorFlip');
    assert.equal(PAGE_TILES.length, 6);
  });

  it('marks only later packages as not available yet', () => {
    assert.deepEqual([...NOT_YET_ACTIONS].sort(), ['abRepeat', 'audio', 'subs', 'upNext']);
    const built = ['speed', 'rotate', 'lock', 'skipBack', 'seekInterval', 'frameByFrame', 'aspectRatio', 'mirrorFlip'] as const;
    for (const action of built) {
      assert.equal(NOT_YET_ACTIONS.has(action), false, action);
    }
  });
});

describe('Player strings', () => {
  it('has every English string in Urdu, with the same placeholders', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const english = videoPlayerEn as Record<string, string>;
    const urdu = videoPlayerUr as Record<string, string>;
    assert.deepEqual(Object.keys(urdu).sort(), Object.keys(english).sort());
    for (const [key, text] of Object.entries(english)) {
      assert.ok(urdu[key]?.trim(), `${key} is empty in Urdu`);
      assert.notEqual(urdu[key], text, `${key} is not translated`);
      assert.deepEqual(placeholders(urdu[key]!), placeholders(text), key);
    }
  });
});
