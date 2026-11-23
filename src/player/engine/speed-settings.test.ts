import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_SPEED_SETTINGS,
  MAX_REMEMBERED_SPEEDS,
  canRememberSpeed,
  forgetRememberedSpeeds,
  getSpeedSettings,
  normalizeRememberedSpeeds,
  normalizeSpeedSettings,
  rememberSpeed,
  rememberedSpeedFor,
  saveSpeedFor,
  setSpeedSettings,
  speedButtonTarget,
  stepPlaybackRate,
} from './speed-settings.ts';

describe('P16 speed and pitch', () => {
  it('defaults: natural voice, each video’s speed, the button opens the sheet, shortcut 1.5×', () => {
    assert.deepEqual(DEFAULT_SPEED_SETTINGS, {
      pitchCorrection: true,
      rememberPerVideo: true,
      speedButton: 'sheet',
      shortcutRate: 1.5,
    });
    assert.deepEqual(normalizeSpeedSettings({ speedButton: 'cycle', shortcutRate: 1, pitchCorrection: 'no' }), DEFAULT_SPEED_SETTINGS);
    assert.equal(normalizeSpeedSettings({ shortcutRate: 2 }).shortcutRate, 2);
  });

  it('#537: − / + move 0.1 within 0.25×–4×', () => {
    assert.equal(stepPlaybackRate(1, 1), 1.1);
    assert.equal(stepPlaybackRate(1.25, 1), 1.35);
    assert.equal(stepPlaybackRate(1.25, -1), 1.15);
    assert.equal(stepPlaybackRate(0.3, -1), 0.25);
    assert.equal(stepPlaybackRate(0.25, -1), 0.25);
    assert.equal(stepPlaybackRate(3.95, 1), 4);
    assert.equal(stepPlaybackRate(Number.NaN, 1), 1.1);
  });

  it('#544: the button opens the sheet, or switches between 1.0× and the shortcut', () => {
    assert.equal(speedButtonTarget(1, { speedButton: 'sheet', shortcutRate: 1.5 }), null);
    assert.equal(speedButtonTarget(1, { speedButton: 'switch', shortcutRate: 1.5 }), 1.5);
    assert.equal(speedButtonTarget(1.5, { speedButton: 'switch', shortcutRate: 1.5 }), 1);
    // Any other speed goes back to normal first.
    assert.equal(speedButtonTarget(0.75, { speedButton: 'switch', shortcutRate: 2 }), 1);
  });

  it('#736: remembers lasting media only, never online streams', () => {
    assert.equal(canRememberSpeed('lib-123'), true);
    assert.equal(canRememberSpeed('device:42'), true);
    assert.equal(canRememberSpeed('external:abc'), true);
    assert.equal(canRememberSpeed('stream:0123456789abcdef0123456789abcdef'), false);
    assert.equal(canRememberSpeed(''), false);
    assert.equal(canRememberSpeed(null), false);
  });

  it('#736: 1.0× forgets the video; past the cap the least recently played go', () => {
    let speeds = rememberSpeed({}, 'a', 1.5, 1);
    speeds = rememberSpeed(speeds, 'b', 0.75, 2);
    assert.deepEqual(speeds, { a: { rate: 1.5, at: 1 }, b: { rate: 0.75, at: 2 } });
    speeds = rememberSpeed(speeds, 'a', 1, 3);
    assert.deepEqual(speeds, { b: { rate: 0.75, at: 2 } });
    let many = {};
    for (let i = 0; i < 5; i += 1) many = rememberSpeed(many, `m${i}`, 2, i, 3);
    assert.deepEqual(Object.keys(many).sort(), ['m2', 'm3', 'm4']);
    assert.equal(MAX_REMEMBERED_SPEEDS, 300);
  });

  it('reads saved speeds defensively', () => {
    assert.deepEqual(
      normalizeRememberedSpeeds({
        ok: { rate: 1.25, at: 5 },
        bad: { rate: 9, at: 5 },
        noTime: { rate: 1.5 },
        'stream:0123456789abcdef0123456789abcdef': { rate: 2, at: 1 },
      }),
      { ok: { rate: 1.25, at: 5 } },
    );
    assert.deepEqual(normalizeRememberedSpeeds('x'), {});
  });

  it('keeps settings and speeds for the run', () => {
    setSpeedSettings({ speedButton: 'switch', shortcutRate: 2 });
    assert.equal(getSpeedSettings().speedButton, 'switch');
    assert.equal(getSpeedSettings().shortcutRate, 2);
    setSpeedSettings(DEFAULT_SPEED_SETTINGS);
    forgetRememberedSpeeds();
    saveSpeedFor('book-1', 1.35, 10);
    assert.equal(rememberedSpeedFor('book-1'), 1.35);
    saveSpeedFor('book-1', 1, 11);
    assert.equal(rememberedSpeedFor('book-1'), null);
    saveSpeedFor('stream:0123456789abcdef0123456789abcdef', 2, 12);
    assert.equal(rememberedSpeedFor('stream:0123456789abcdef0123456789abcdef'), null);
  });
});
