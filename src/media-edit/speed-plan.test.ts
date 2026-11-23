/**
 * P12 Change speed (#684): 0.25× to 4× (not 1×), the part inside the video (at least 1 s; all of it is the whole
 * video), the copy's length = the part ÷ the speed, the space it needs (the same numbers as SpeedPlanTest.kt), the
 * request.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  SPEED_CHOICES,
  SPEED_DEFAULT,
  SPEED_MAX,
  SPEED_MIN,
  formatExportSpeed,
  isValidExportSpeed,
  speedAvailability,
  speedEstimateBytes,
  speedKeptMs,
  speedOutputMs,
  speedRange,
  speedRequest,
  type SpeedSource,
} from './speed-plan';

function source(overrides: Partial<SpeedSource> = {}): SpeedSource {
  return {
    id: 'lib1',
    title: 'Beach clip',
    mimeType: 'video/mp4',
    durationMs: 600_000,
    sizeBytes: 600_000_000,
    hasAudio: true,
    ...overrides,
  };
}

describe('Change speed: the speed', () => {
  test('0.25× to 4×, never 1×', () => {
    assert.equal(SPEED_MIN, 0.25);
    assert.equal(SPEED_MAX, 4);
    for (const speed of SPEED_CHOICES) {
      assert.equal(isValidExportSpeed(speed), true, String(speed));
    }
    assert.ok(SPEED_CHOICES.includes(SPEED_DEFAULT));
    for (const speed of [0.2, 4.5, 1, 1.0004, Number.NaN, Number.POSITIVE_INFINITY, -2]) {
      assert.equal(isValidExportSpeed(speed), false, String(speed));
    }
    assert.deepEqual(SPEED_CHOICES.map(formatExportSpeed), ['0.25×', '0.5×', '0.75×', '1.25×', '1.5×', '2×', '3×', '4×']);
  });
});

describe('Change speed: the part', () => {
  test('stays inside the video, at least a second; all of it is the whole video', () => {
    assert.deepEqual(speedRange(null, 60_000), { ok: true, range: null });
    assert.deepEqual(speedRange({ startMs: 10_000, endMs: 20_000 }, 60_000), { ok: true, range: { startMs: 10_000, endMs: 20_000 } });
    assert.deepEqual(speedRange({ startMs: 59_500, endMs: 60_000 }, 60_000), { ok: true, range: { startMs: 59_000, endMs: 60_000 } });
    assert.deepEqual(speedRange({ startMs: 0, endMs: 60_000 }, 60_000), { ok: true, range: null });
    assert.deepEqual(speedRange({ startMs: 0, endMs: 90_000 }, 60_000), { ok: true, range: null });
    assert.deepEqual(speedRange({ startMs: 0, endMs: 500 }, 900), { ok: false, reason: 'too-short' });
    assert.deepEqual(speedRange(null, null), { ok: false, reason: 'no-duration' });
  });

  test('the copy is the part divided by the speed', () => {
    assert.equal(speedOutputMs(10_000, 2), 5_000);
    assert.equal(speedOutputMs(10_000, 0.25), 40_000);
    assert.equal(speedOutputMs(10_000, 0.75), 13_333);
    assert.equal(speedOutputMs(10_000, 3), 3_333);
    assert.equal(speedOutputMs(10_000, 4), 2_500);
    assert.equal(speedKeptMs(null, 60_000), 60_000);
    assert.equal(speedKeptMs({ startMs: 10_000, endMs: 25_000 }, 60_000), 15_000);
  });

  test('the space is the part re-encoded, divided by the speed (the same numbers as Kotlin)', () => {
    assert.equal(speedEstimateBytes(source(), null, 2), 600_000_000);
    assert.equal(speedEstimateBytes(source(), { startMs: 60_000, endMs: 120_000 }, 0.5), 240_000_000);
    assert.equal(speedEstimateBytes(source(), null, 0.25), 4_800_000_000);
  });
});

describe('Change speed: which videos, and the request', () => {
  test('a video, a valid speed, a valid part', () => {
    assert.equal(speedAvailability(source(), 2, null), 'ok');
    assert.equal(speedAvailability(source({ mimeType: 'audio/mp4' }), 2, null), 'audio-source');
    assert.equal(speedAvailability(source(), 1, null), 'bad-speed');
    assert.equal(speedAvailability(source({ durationMs: null }), 2, null), 'no-duration');
    assert.equal(speedAvailability(source({ durationMs: 900 }), 2, { startMs: 0, endMs: 500 }), 'too-short');
  });

  test('the whole video or a part; the video re-encoded, the sound with it', () => {
    assert.deepEqual(speedRequest(source(), 0.5, { startMs: 10_000, endMs: 20_000 }, 'Beach clip (0.5× speed)'), {
      sourceId: 'lib1',
      kind: 'speed',
      startMs: 10_000,
      endMs: 20_000,
      keyframeStart: false,
      video: 'h264',
      audio: 'aac',
      title: 'Beach clip (0.5× speed)',
      speed: 0.5,
    });
    const whole = speedRequest(source({ hasAudio: false }), 4, null, 't');
    assert.equal(whole.startMs, null);
    assert.equal(whole.endMs, null);
    assert.equal(whole.audio, 'drop');
  });
});
