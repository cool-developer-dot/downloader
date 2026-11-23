/**
 * P12 Create GIF (#676): the part (1–15 s, inside the video), the size (never wider than the video), the frame count,
 * the estimate shown before starting and the space check (the same numbers as GifExportTest.kt), and the request.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  GIF_DEFAULT_FPS,
  GIF_DEFAULT_LENGTH_MS,
  GIF_DEFAULT_WIDTH,
  GIF_FRAME_RATES,
  GIF_LENGTHS_MS,
  GIF_MAX_LENGTH_MS,
  GIF_WIDTHS,
  gifAvailability,
  gifEstimateBytes,
  gifFrameCount,
  gifLengthOptions,
  gifMaxBytes,
  gifOutputSize,
  gifPreview,
  gifRange,
  gifRequest,
  gifSpaceNeededBytes,
  gifTitle,
  gifWidthOptions,
  type GifSource,
} from './gif-plan';

function source(overrides: Partial<GifSource> = {}): GifSource {
  return { id: 'lib1', title: 'Beach clip', mimeType: 'video/mp4', durationMs: 60_000, width: 1920, height: 1080, ...overrides };
}

describe('Create GIF: the part', () => {
  test('is 1 to 15 seconds and stays inside the video', () => {
    assert.deepEqual(gifRange(2_000, 5_000, 60_000), { startMs: 2_000, endMs: 7_000 });
    // Near the end the start moves back, so the length chosen is kept.
    assert.deepEqual(gifRange(58_000, 5_000, 60_000), { startMs: 55_000, endMs: 60_000 });
    // Capped at 15 s; at least 1 s.
    assert.deepEqual(gifRange(0, 20_000, 60_000), { startMs: 0, endMs: GIF_MAX_LENGTH_MS });
    assert.deepEqual(gifRange(500, 100, 60_000), { startMs: 500, endMs: 1_500 });
    // A video shorter than the part asked: all of it.
    assert.deepEqual(gifRange(0, 5_000, 3_000), { startMs: 0, endMs: 3_000 });
    assert.deepEqual(gifRange(-4_000, 3_000, 60_000), { startMs: 0, endMs: 3_000 });
    assert.equal(gifRange(0, 1_000, 800), null);
    assert.equal(gifRange(0, 1_000, null), null);
  });

  test('the lengths offered fit in the video', () => {
    assert.deepEqual(gifLengthOptions(60_000), [2_000, 3_000, 5_000, 10_000, 15_000]);
    assert.deepEqual(gifLengthOptions(7_000), [2_000, 3_000, 5_000]);
    // Shorter than the shortest: its own length, to a tenth of a second.
    assert.deepEqual(gifLengthOptions(1_480), [1_400]);
    assert.deepEqual(gifLengthOptions(900), []);
    assert.deepEqual(gifLengthOptions(null), []);
  });

  test('the sheet offers 2–15 s, 320 / 480 px and 5 / 10 / 15 fps', () => {
    assert.deepEqual([...GIF_LENGTHS_MS], [2_000, 3_000, 5_000, 10_000, 15_000]);
    assert.ok(GIF_LENGTHS_MS.every((length) => length <= GIF_MAX_LENGTH_MS));
    assert.deepEqual([...GIF_WIDTHS], [320, 480]);
    assert.deepEqual([...GIF_FRAME_RATES], [5, 10, 15]);
    assert.ok(GIF_LENGTHS_MS.includes(GIF_DEFAULT_LENGTH_MS));
    assert.ok(GIF_WIDTHS.includes(GIF_DEFAULT_WIDTH));
    assert.ok(GIF_FRAME_RATES.includes(GIF_DEFAULT_FPS));
  });
});

describe('Create GIF: the size', () => {
  test('is never wider than the video and keeps its aspect', () => {
    assert.deepEqual(gifOutputSize(1920, 1080, 480), { width: 480, height: 270 });
    assert.deepEqual(gifOutputSize(1920, 1080, 320), { width: 320, height: 180 });
    assert.deepEqual(gifOutputSize(1280, 720, 320), { width: 320, height: 180 });
    assert.deepEqual(gifOutputSize(1080, 1920, 480), { width: 480, height: 853 });
    assert.deepEqual(gifOutputSize(300, 200, 480), { width: 300, height: 200 });
    assert.equal(gifOutputSize(null, 1080, 480), null);
  });

  test('presets that come out the same are one choice', () => {
    assert.deepEqual(
      gifWidthOptions(1920, 1080).map((option) => option.size),
      [
        { width: 320, height: 180 },
        { width: 480, height: 270 },
      ],
    );
    // A 400 px video: 320, and its own 400 for the 480 preset.
    assert.deepEqual(gifWidthOptions(400, 300).map((option) => option.size.width), [320, 400]);
    // A 300 px video: only its own width.
    assert.deepEqual(gifWidthOptions(300, 200).map((option) => option.size.width), [300]);
    assert.deepEqual(gifWidthOptions(null, null), []);
  });
});

describe('Create GIF: frames and the size estimate (the same maths as Kotlin)', () => {
  test('one frame every 1/fps second', () => {
    assert.equal(gifFrameCount(5_000, 10), 50);
    assert.equal(gifFrameCount(15_000, 15), 225);
    assert.equal(gifFrameCount(2_950, 10), 30);
    assert.equal(gifFrameCount(1_000, 15), 15);
    assert.equal(gifFrameCount(0, 10), 0);
  });

  test('estimate = 33 + frames × (788 + L + ⌈L / 255⌉), L at 3/5 byte a pixel; the space check at 3/2, twice', () => {
    // 5 s at 10 fps, 480 × 270: L = 77 760 typical, 194 400 at most.
    assert.equal(gifEstimateBytes(50, 480, 270), 3_942_683);
    assert.equal(gifMaxBytes(50, 480, 270), 9_797_583);
    assert.equal(gifSpaceNeededBytes(50, 480, 270), 19_595_166);
    assert.equal(gifEstimateBytes(0, 480, 270), 0);
    // The longest, largest GIF: 15 s at 15 fps, 480 × 270 — about 17.7 MB.
    assert.equal(gifEstimateBytes(225, 480, 270), 33 + 225 * (788 + 77_760 + 305));
  });

  test('the preview is what the sheet shows', () => {
    const preview = gifPreview(source(), { startMs: 2_000, lengthMs: 5_000, width: 480, fps: 10 });
    assert.deepEqual(preview, {
      range: { startMs: 2_000, endMs: 7_000 },
      size: { width: 480, height: 270 },
      frames: 50,
      estimateBytes: 3_942_683,
      spaceBytes: 19_595_166,
    });
    // A frame rate the sheet doesn't offer, or a video it can't make: nothing.
    assert.equal(gifPreview(source(), { startMs: 0, lengthMs: 3_000, width: 320, fps: 24 }), null);
    assert.equal(gifPreview(source({ width: null }), { startMs: 0, lengthMs: 3_000, width: 320, fps: 10 }), null);
  });
});

describe('Create GIF: which videos, and the request', () => {
  test('a video with a length, a size and at least a second', () => {
    assert.equal(gifAvailability(source()), 'ok');
    assert.equal(gifAvailability(source({ mimeType: 'audio/mp4' })), 'audio-source');
    assert.equal(gifAvailability(source({ durationMs: null })), 'no-duration');
    assert.equal(gifAvailability(source({ durationMs: 700 })), 'too-short');
    assert.equal(gifAvailability(source({ height: 0 })), 'no-size');
  });

  test('the request has the clamped part, the real width and the title', () => {
    assert.deepEqual(gifRequest(source(), { startMs: 58_000, lengthMs: 5_000, width: 480, fps: 15 }, 'Beach clip 0m55.0s'), {
      sourceId: 'lib1',
      startMs: 55_000,
      endMs: 60_000,
      width: 480,
      fps: 15,
      title: 'Beach clip 0m55.0s',
    });
    // A 300 px video at the 480 preset: its own 300.
    assert.equal(gifRequest(source({ width: 300, height: 200 }), { startMs: 0, lengthMs: 3_000, width: 480, fps: 5 }, 'x')?.width, 300);
    assert.equal(gifTitle('Beach clip', 83_400, 'Clip'), 'Beach clip 1m23.4s');
    assert.equal(gifTitle('  ', 0, 'Clip'), 'Clip 0m00.0s');
  });
});
