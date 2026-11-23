import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  audioTrackLabel,
  canRememberDelay,
  formatAudioDelay,
  getAudioOnly,
  isSameAudioTrack,
  normalizeAudioDelay,
  normalizeRememberedDelays,
  playingAudioTrack,
  rememberDelay,
  rememberedDelayFor,
  saveDelayFor,
  setAudioOnly,
  stepAudioDelay,
} from './audio-settings.ts';

const n = (i: number) => `Track ${i}`;

describe('P17 audio tracks, delay and audio only', () => {
  it('#553 names tracks from the label, the language, the name, or their number', () => {
    assert.equal(audioTrackLabel({ label: 'English', language: 'en' }, 0, n), 'English');
    assert.equal(audioTrackLabel({ label: 'English', name: 'Commentary' }, 0, n), 'English · Commentary');
    assert.equal(audioTrackLabel({ label: 'Urdu', name: 'urdu' }, 1, n), 'Urdu');
    assert.equal(audioTrackLabel({ language: 'ur' }, 1, n), 'ur');
    assert.equal(audioTrackLabel({ label: ' ', language: '' }, 2, n), 'Track 3');
    assert.equal(isSameAudioTrack({ id: 'a1', label: 'x' }, { id: 'a1', label: 'y' }), true);
    assert.equal(isSameAudioTrack({ label: 'English', language: 'en' }, { label: 'English', language: 'en' }), true);
    assert.equal(isSameAudioTrack({ id: 'a1' }, null), false);
  });

  it('#553 shows the default track as playing until the player reports one', () => {
    const en = { id: 'a', label: 'English' };
    const ur = { id: 'b', label: 'Urdu', isDefault: true };
    assert.equal(playingAudioTrack([en, ur], null), ur);
    assert.equal(playingAudioTrack([en, { id: 'c' }], undefined), en);
    assert.equal(playingAudioTrack([en, ur], en), en);
    assert.equal(playingAudioTrack([], null), null);
  });

  it('#554 keeps the delay on 50 ms steps within ±3 s', () => {
    assert.equal(normalizeAudioDelay(120), 100);
    assert.equal(normalizeAudioDelay(130), 150);
    assert.equal(normalizeAudioDelay(-9000), -3000);
    assert.equal(normalizeAudioDelay('5'), 0);
    assert.equal(stepAudioDelay(0, 1), 50);
    assert.equal(stepAudioDelay(-50, 1), 0);
    assert.equal(stepAudioDelay(3000, 1), 3000);
    assert.equal(formatAudioDelay(150), '+150 ms');
    assert.equal(formatAudioDelay(-50), '−50 ms');
    assert.equal(formatAudioDelay(0), '0 ms');
  });

  it('#554 remembers each video’s delay (not streams); 0 forgets it; the oldest go past the cap', () => {
    assert.equal(canRememberDelay('stream:0123456789abcdef0123456789abcdef'), false);
    let map = rememberDelay({}, 'a', 200, 1);
    map = rememberDelay(map, 'b', -100, 2);
    map = rememberDelay(map, 'a', 0, 3);
    assert.deepEqual(map, { b: { ms: -100, at: 2 } });
    let many = {};
    for (let i = 0; i < 4; i += 1) many = rememberDelay(many, `v${i}`, 50, i, 2);
    assert.deepEqual(Object.keys(many).sort(), ['v2', 'v3']);
    assert.deepEqual(normalizeRememberedDelays({ ok: { ms: 120, at: 1 }, zero: { ms: 0, at: 1 }, bad: 'x' }), {
      ok: { ms: 100, at: 1 },
    });
    saveDelayFor('lecture-1', 250, 10);
    assert.equal(rememberedDelayFor('lecture-1'), 250);
    saveDelayFor('lecture-1', 0, 11);
    assert.equal(rememberedDelayFor('lecture-1'), 0);
  });

  it('#574 Audio only is for this run', () => {
    assert.equal(getAudioOnly(), false);
    setAudioOnly(true);
    assert.equal(getAudioOnly(), true);
    setAudioOnly(false);
  });
});
