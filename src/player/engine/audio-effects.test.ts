import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_AUDIO_EFFECTS,
  MAX_USER_PRESETS,
  PRESET_GAINS,
  addUserPreset,
  choosePreset,
  deleteUserPreset,
  getAudioEffects,
  mapGainsToDevice,
  normalizeAudioEffects,
  normalizeGains,
  presetGains,
  resetAudioEffects,
  saveUserPreset,
  setAudioEffects,
  setBandGain,
} from './audio-effects.ts';

const aospBands = [60, 230, 910, 3600, 14000].map((centerHz) => ({ centerHz, minMb: -1500, maxMb: 1500 }));

describe('P19 audio effects and EQ', () => {
  it('defaults to everything off and flat', () => {
    assert.deepEqual(normalizeAudioEffects(undefined), DEFAULT_AUDIO_EFFECTS);
    assert.equal(DEFAULT_AUDIO_EFFECTS.volumeBoost, 100);
  });

  it('reads saved settings within their ranges', () => {
    const read = normalizeAudioEffects({
      eqEnabled: true,
      preset: 'nope',
      gains: [20, -20, 3.4, 'x'],
      bassBoost: 140,
      virtualizer: -3,
      volumeBoost: 300,
      balance: -250,
      mono: 'yes',
      userPresets: [{ id: 'a', name: ' Mine ', gains: [1, 2, 3, 4, 5] }, { id: '', name: 'bad' }, { id: 'b', name: '  ' }],
    });
    assert.equal(read.preset, 'flat');
    assert.deepEqual(read.gains, [12, -12, 3, 0, 0]);
    assert.equal(read.bassBoost, 100);
    assert.equal(read.virtualizer, 0);
    assert.equal(read.volumeBoost, 200);
    assert.equal(read.balance, -100);
    assert.equal(read.mono, false);
    assert.deepEqual(read.userPresets, [{ id: 'a', name: 'Mine', gains: [1, 2, 3, 4, 5] }]);
    assert.equal(normalizeAudioEffects({ preset: 'user:a', userPresets: read.userPresets }).preset, 'user:a');
    assert.deepEqual(normalizeGains(null), [0, 0, 0, 0, 0]);
  });

  it('#550 has the built-in presets, and #729 the user’s', () => {
    assert.deepEqual(presetGains('rock', []), [...PRESET_GAINS.rock]);
    assert.deepEqual(presetGains('user:x', [{ id: 'x', name: 'X', gains: [1, 1, 1, 1, 1] }]), [1, 1, 1, 1, 1]);
    assert.equal(presetGains('custom', []), null);
    assert.equal(presetGains('user:gone', []), null);
  });

  it('#549 maps the five gains onto the phone’s own bands', () => {
    // The AOSP equalizer has the design's bands: the same gains, in millibels.
    assert.deepEqual(mapGainsToDevice([6, 4, 0, -1, -2], aospBands), [600, 400, 0, -100, -200]);
    // Other bands read the curve between neighbours (log frequency) and stay inside the phone's range.
    const narrow = [
      { centerHz: 31, minMb: -1000, maxMb: 1000 },
      { centerHz: 455, minMb: -1000, maxMb: 1000 },
      { centerHz: 20000, minMb: -1000, maxMb: 1000 },
    ];
    const mapped = mapGainsToDevice([12, 0, 12, 0, -12], narrow);
    assert.equal(mapped[0], 1000);
    assert.ok(mapped[1] > 0 && mapped[1] < 1000);
    assert.equal(mapped[2], -1000);
    assert.deepEqual(mapGainsToDevice([1, 2, 3, 4, 5], []), []);
  });

  it('#729 saves named presets, the newest first, at most 20', () => {
    assert.equal(addUserPreset([], '  ', [0, 0, 0, 0, 0], 'a'), null);
    let presets = addUserPreset([], 'Night drive', [3, 2, 1, 0, -1], 'a') ?? [];
    presets = addUserPreset(presets, 'Talks', [0, 0, 4, 3, 0], 'b') ?? [];
    assert.deepEqual(presets.map((p) => p.name), ['Talks', 'Night drive']);
    let many = presets;
    for (let i = 0; i < 25; i += 1) many = addUserPreset(many, `P${i}`, [0, 0, 0, 0, 0], `id${i}`) ?? many;
    assert.equal(many.length, MAX_USER_PRESETS);
  });

  it('keeps the store consistent: presets, a band moved by hand, save, delete, reset', () => {
    resetAudioEffects();
    choosePreset('bass');
    assert.equal(getAudioEffects().eqEnabled, true);
    assert.deepEqual(getAudioEffects().gains, [...PRESET_GAINS.bass]);
    setBandGain(2, 5);
    assert.equal(getAudioEffects().preset, 'custom');
    assert.equal(saveUserPreset('Mine', 1_000), true);
    const saved = getAudioEffects();
    assert.equal(saved.preset, `user:${(1_000).toString(36)}`);
    assert.deepEqual(saved.userPresets[0].gains, [6, 4, 5, -1, -2]);
    deleteUserPreset(saved.userPresets[0].id);
    assert.equal(getAudioEffects().preset, 'custom');
    assert.equal(getAudioEffects().userPresets.length, 0);
    setAudioEffects({ volumeBoost: 150, mono: true });
    resetAudioEffects();
    assert.equal(getAudioEffects().volumeBoost, 100);
    assert.equal(getAudioEffects().mono, false);
  });
});
