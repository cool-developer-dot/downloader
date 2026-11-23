/**
 * P10 Compress video (#680): the presets, the estimated size shown before starting (the same maths as
 * CompressPlanTest.kt), when a preset is offered, and the request the native editor receives.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COMPRESS_AUDIO_ESTIMATE_BITRATE,
  COMPRESS_CONTAINER_OVERHEAD,
  COMPRESS_MAX_OUTPUT_RATIO,
  COMPRESS_PRESETS,
  COMPRESS_TARGETS,
  compressAvailability,
  compressEstimateBytes,
  compressOptions,
  compressOutputShortSide,
  compressRequest,
  compressResolutionLabel,
  type CompressSource,
} from './compress-plan';
import { editAvailability, trackPlan, type EditSource } from './edit-plan';

type Source = EditSource & CompressSource;

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'lib1',
    title: 'Beach clip',
    videoCodec: 'video/avc',
    audioCodec: 'audio/mp4a-latm',
    hasAudio: true,
    container: 'mp4',
    mimeType: 'video/mp4',
    // 10 minutes of 1080p at about 8 Mbit/s.
    durationMs: 600_000,
    sizeBytes: 600_000_000,
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

describe('compress presets', () => {
  test('High, Medium and Small: 1080p at 4 Mbit/s, 720p at 2 Mbit/s, 480p at 1 Mbit/s', () => {
    assert.deepEqual(COMPRESS_PRESETS, ['high', 'medium', 'small']);
    assert.deepEqual(COMPRESS_TARGETS.high, { videoBitrate: 4_000_000, maxShortSide: 1080 });
    assert.deepEqual(COMPRESS_TARGETS.medium, { videoBitrate: 2_000_000, maxShortSide: 720 });
    assert.deepEqual(COMPRESS_TARGETS.small, { videoBitrate: 1_000_000, maxShortSide: 480 });
    // Each preset is smaller than the one before (bitrate and size).
    assert.ok(COMPRESS_TARGETS.high.videoBitrate > COMPRESS_TARGETS.medium.videoBitrate);
    assert.ok(COMPRESS_TARGETS.medium.maxShortSide > COMPRESS_TARGETS.small.maxShortSide);
  });

  test('the native side accepts every preset (100 kbit/s – 50 Mbit/s, short side 144 – 4320)', () => {
    for (const preset of COMPRESS_PRESETS) {
      const target = COMPRESS_TARGETS[preset];
      assert.ok(target.videoBitrate >= 100_000 && target.videoBitrate <= 50_000_000, preset);
      assert.ok(target.maxShortSide >= 144 && target.maxShortSide <= 4_320, preset);
    }
  });
});

describe('estimated output size', () => {
  test('(video bitrate + 128 kbit/s sound) × length ÷ 8 × 1.02, the numbers CompressPlanTest.kt checks', () => {
    const target = { videoBitrate: 2_000_000, maxShortSide: 720 };
    assert.equal(compressEstimateBytes(60_000, target, true), 16_279_200);
    assert.equal(compressEstimateBytes(60_000, target, false), 15_300_000);
    assert.equal(COMPRESS_AUDIO_ESTIMATE_BITRATE, 128_000);
    assert.equal(COMPRESS_CONTAINER_OVERHEAD, 1.02);
  });

  test('scales with the length and rounds up to whole bytes', () => {
    const target = COMPRESS_TARGETS.small;
    const tenMinutes = compressEstimateBytes(600_000, target, true);
    assert.equal(tenMinutes, Math.ceil((((1_000_000 + 128_000) * 600) / 8) * 1.02));
    assert.equal(compressEstimateBytes(1_200_000, target, true), tenMinutes * 2);
    assert.ok(Number.isInteger(compressEstimateBytes(1_234, target, true)));
  });

  test('an unknown, zero or broken length estimates nothing', () => {
    for (const length of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(compressEstimateBytes(length, COMPRESS_TARGETS.high, true), 0, String(length));
    }
  });
});

describe('output resolution', () => {
  test('the short side shrinks to the preset, never grows, and portrait counts its width', () => {
    assert.equal(compressOutputShortSide(1920, 1080, 720), 720);
    assert.equal(compressOutputShortSide(1080, 1920, 720), 720);
    assert.equal(compressOutputShortSide(1280, 720, 1080), 720);
    assert.equal(compressOutputShortSide(640, 360, 480), 360);
    assert.equal(compressOutputShortSide(null, 1080, 720), null);
    assert.equal(compressOutputShortSide(1920, 0, 720), null);
  });

  test('is named like video sizes', () => {
    assert.equal(compressResolutionLabel(720), '720p');
    assert.equal(compressResolutionLabel(null), null);
    assert.equal(compressResolutionLabel(0), null);
  });
});

describe('which presets are offered', () => {
  test('a big 1080p video can take all three, each with its size and resolution', () => {
    const options = compressOptions(source());
    assert.deepEqual(
      options.map((option) => [option.preset, option.availability, option.shortSide]),
      [
        ['high', 'ok', 1080],
        ['medium', 'ok', 720],
        ['small', 'ok', 480],
      ],
    );
    assert.equal(options[1]!.estimateBytes, compressEstimateBytes(600_000, COMPRESS_TARGETS.medium, true));
    assert.ok(options[0]!.estimateBytes > options[1]!.estimateBytes && options[1]!.estimateBytes > options[2]!.estimateBytes);
  });

  test('a preset that would not save 10 % of the size is not offered', () => {
    // 10 minutes at about 3 Mbit/s: High (4 Mbit/s) would be bigger; Medium and Small save.
    const small = source({ sizeBytes: 225_000_000 });
    assert.equal(compressAvailability(small, 'high'), 'no-gain');
    assert.equal(compressAvailability(small, 'medium'), 'ok');
    // At 90 % of the size it is still offered; just above it is not.
    const estimate = compressEstimateBytes(600_000, COMPRESS_TARGETS.small, true);
    assert.equal(compressAvailability(source({ sizeBytes: Math.ceil(estimate / COMPRESS_MAX_OUTPUT_RATIO) + 1 }), 'small'), 'ok');
    assert.equal(compressAvailability(source({ sizeBytes: Math.floor(estimate / COMPRESS_MAX_OUTPUT_RATIO) - 10 }), 'small'), 'no-gain');
  });

  test('audio files and videos of unknown length are refused', () => {
    assert.equal(compressAvailability(source({ mimeType: 'audio/mp4' }), 'small'), 'audio-source');
    assert.equal(compressAvailability(source({ durationMs: null }), 'small'), 'no-duration');
    assert.equal(editAvailability('compress', source({ durationMs: 0 })), 'no-duration');
    assert.equal(editAvailability('compress', source({ mimeType: 'audio/mpeg' })), 'audio-source');
    // Compress is never "already MP4", unlike Convert.
    assert.equal(editAvailability('compress', source()), 'ok');
  });
});

describe('the request', () => {
  test('a whole-video edit that re-encodes the video, with the preset’s target', () => {
    const request = compressRequest(source(), 'medium', 'Beach clip (compressed)');
    assert.deepEqual(request, {
      sourceId: 'lib1',
      kind: 'compress',
      startMs: null,
      endMs: null,
      keyframeStart: false,
      video: 'h264',
      audio: 'copy',
      title: 'Beach clip (compressed)',
      videoBitrate: 2_000_000,
      maxShortSide: 720,
    });
  });

  test('the sound is copied when it is AAC, re-encoded otherwise, left out when there is none', () => {
    assert.deepEqual(trackPlan('compress', source()), { video: 'h264', audio: 'copy' });
    assert.deepEqual(trackPlan('compress', source({ audioCodec: 'audio/opus' })), { video: 'h264', audio: 'aac' });
    assert.deepEqual(trackPlan('compress', source({ hasAudio: false })), { video: 'h264', audio: 'drop' });
    // An H.265 or VP9 video is re-encoded to H.264 too (a copy would not be smaller).
    assert.equal(trackPlan('compress', source({ videoCodec: 'video/hevc' })).video, 'h264');
  });
});
