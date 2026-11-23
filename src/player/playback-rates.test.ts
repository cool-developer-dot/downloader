import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATES,
  formatPlaybackRateChip,
  normalizePlaybackRate,
  roundPlaybackRate,
} from './playback-rates.ts';

describe('playback rates (P16 #537)', () => {
  it('keeps every preset', () => {
    for (const rate of PLAYBACK_RATES) assert.equal(normalizePlaybackRate(rate), rate);
  });

  it('accepts any speed from 0.25× to 4× on the 0.05 grid', () => {
    assert.equal(MIN_PLAYBACK_RATE, 0.25);
    assert.equal(MAX_PLAYBACK_RATE, 4);
    assert.equal(normalizePlaybackRate(0.25), 0.25);
    assert.equal(normalizePlaybackRate(1.1), 1.1);
    assert.equal(normalizePlaybackRate(1.15), 1.15);
    assert.equal(normalizePlaybackRate(1.12), 1.1);
    assert.equal(normalizePlaybackRate(3.98), 4);
    assert.equal(normalizePlaybackRate(4), 4);
    assert.equal(roundPlaybackRate(1.1500000000000001), 1.15);
  });

  it('rejects, never clamps, anything else', () => {
    for (const value of [0, 0.2, 4.5, -1, Number.NaN, Infinity, '1.5', null, undefined]) {
      assert.equal(normalizePlaybackRate(value), null, String(value));
    }
  });

  it('labels the chip with at least one decimal', () => {
    assert.equal(formatPlaybackRateChip(1), '1.0×');
    assert.equal(formatPlaybackRateChip(1.1), '1.1×');
    assert.equal(formatPlaybackRateChip(1.15), '1.15×');
    assert.equal(formatPlaybackRateChip(0.25), '0.25×');
    assert.equal(formatPlaybackRateChip(4), '4.0×');
  });
});
