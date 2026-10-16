import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  clampTrimRange,
  EDIT_FREE_SPACE_MARGIN_BYTES,
  editAvailability,
  editOutputTitle,
  editRequest,
  estimateEditBytes,
  formatTrimTime,
  hasRoomForEdit,
  MAX_EDIT_TITLE_LENGTH,
  MIN_TRIM_MS,
  trackPlan,
  trimsNothing,
  type EditSource,
} from './edit-plan';

function source(overrides: Partial<EditSource> = {}): EditSource {
  return {
    id: 'lib1',
    title: 'Beach clip',
    videoCodec: 'video/avc',
    audioCodec: 'audio/mp4a-latm',
    hasAudio: true,
    container: 'mp4',
    mimeType: 'video/mp4',
    durationMs: 60_000,
    sizeBytes: 100_000_000,
    ...overrides,
  };
}

describe('trim range validation and clamping', () => {
  test('a valid range is kept, rounded to whole milliseconds', () => {
    assert.deepEqual(clampTrimRange({ startMs: 1_000.4, endMs: 5_000.6 }, 60_000), { ok: true, range: { startMs: 1_000, endMs: 5_001 } });
  });

  test('the start and end stay inside the video', () => {
    assert.deepEqual(clampTrimRange({ startMs: -500, endMs: 90_000 }, 60_000), { ok: true, range: { startMs: 0, endMs: 60_000 } });
  });

  test('at least one second is kept, whichever handle moved', () => {
    assert.deepEqual(clampTrimRange({ startMs: 10_000, endMs: 10_200 }, 60_000), {
      ok: true,
      range: { startMs: 10_000, endMs: 10_000 + MIN_TRIM_MS },
    });
    assert.deepEqual(clampTrimRange({ startMs: 59_800, endMs: 60_000 }, 60_000), {
      ok: true,
      range: { startMs: 60_000 - MIN_TRIM_MS, endMs: 60_000 },
    });
  });

  test('a video without a known length, or shorter than a second, cannot be trimmed', () => {
    assert.deepEqual(clampTrimRange({ startMs: 0, endMs: 1 }, null), { ok: false, reason: 'no-duration' });
    assert.deepEqual(clampTrimRange({ startMs: 0, endMs: 1 }, 0), { ok: false, reason: 'no-duration' });
    assert.deepEqual(clampTrimRange({ startMs: 0, endMs: 500 }, 900), { ok: false, reason: 'too-short' });
  });

  test('non-numbers fall back to the whole video', () => {
    assert.deepEqual(clampTrimRange({ startMs: Number.NaN, endMs: Number.POSITIVE_INFINITY }, 30_000), {
      ok: true,
      range: { startMs: 0, endMs: 30_000 },
    });
  });

  test('a range covering everything trims nothing', () => {
    assert.equal(trimsNothing({ startMs: 0, endMs: 60_000 }, 60_000), true);
    assert.equal(trimsNothing({ startMs: 1, endMs: 60_000 }, 60_000), false);
  });
});

describe('format decisions', () => {
  test('MP4: H.264 and H.265 are remuxed (copied); anything else is transcoded to H.264', () => {
    assert.deepEqual(trackPlan('mp4', source()), { video: 'copy', audio: 'copy' });
    assert.deepEqual(trackPlan('mp4', source({ videoCodec: 'video/hevc' })), { video: 'copy', audio: 'copy' });
    assert.deepEqual(trackPlan('mp4', source({ videoCodec: 'video/x-vnd.on2.vp9' })), { video: 'h264', audio: 'copy' });
    assert.deepEqual(trackPlan('mp4', source({ videoCodec: null })), { video: 'h264', audio: 'copy' });
  });

  test('AAC always passes through; other audio is re-encoded to AAC; no audio is left out', () => {
    assert.equal(trackPlan('mp4', source({ audioCodec: 'audio/mp4a-latm' })).audio, 'copy');
    assert.equal(trackPlan('mp4', source({ audioCodec: 'AUDIO/AAC' })).audio, 'copy');
    assert.equal(trackPlan('mp4', source({ audioCodec: 'audio/opus' })).audio, 'aac');
    assert.equal(trackPlan('mp4', source({ audioCodec: 'audio/mpeg' })).audio, 'aac');
    assert.equal(trackPlan('mp4', source({ hasAudio: false, audioCodec: null })).audio, 'drop');
  });

  test('audio only drops the video and keeps AAC as it is', () => {
    assert.deepEqual(trackPlan('audio', source()), { video: 'drop', audio: 'copy' });
    assert.deepEqual(trackPlan('audio', source({ audioCodec: 'audio/vorbis' })), { video: 'drop', audio: 'aac' });
  });

  test('trim copies the video only from a keyframe; an exact start re-encodes it', () => {
    assert.deepEqual(trackPlan('trim', source(), true), { video: 'copy', audio: 'copy' });
    assert.deepEqual(trackPlan('trim', source(), false), { video: 'h264', audio: 'copy' });
    assert.deepEqual(trackPlan('trim', source({ videoCodec: 'video/x-vnd.on2.vp8' }), true), { video: 'h264', audio: 'copy' });
  });

  test('what each edit is available for, and why not', () => {
    assert.equal(editAvailability('mp4', source()), 'already-mp4');
    assert.equal(editAvailability('mp4', source({ audioCodec: 'audio/opus' })), 'ok');
    assert.equal(editAvailability('mp4', source({ container: 'mkv' })), 'ok');
    assert.equal(editAvailability('mp4', source({ container: 'webm', videoCodec: 'video/x-vnd.on2.vp9' })), 'ok');
    assert.equal(editAvailability('mp4', source({ mimeType: 'audio/mp4', videoCodec: null })), 'audio-source');
    assert.equal(editAvailability('audio', source({ hasAudio: false })), 'no-audio');
    assert.equal(editAvailability('audio', source()), 'ok');
    assert.equal(editAvailability('trim', source({ durationMs: 800 })), 'too-short');
    assert.equal(editAvailability('trim', source({ durationMs: null })), 'no-duration');
    assert.equal(editAvailability('trim', source()), 'ok');
  });

  test('the request carries the plan; a keyframe start only when the video is copied', () => {
    const trim = editRequest('trim', source(), 'Beach clip (trimmed)', { range: { startMs: 2_000, endMs: 9_000 }, keyframeStart: true });
    assert.deepEqual(trim, {
      sourceId: 'lib1',
      kind: 'trim',
      startMs: 2_000,
      endMs: 9_000,
      keyframeStart: true,
      video: 'copy',
      audio: 'copy',
      title: 'Beach clip (trimmed)',
    });
    const vp9 = editRequest('trim', source({ videoCodec: 'video/x-vnd.on2.vp9' }), 'x', { range: { startMs: 0, endMs: 2_000 }, keyframeStart: true });
    assert.equal(vp9.keyframeStart, false);
    assert.equal(vp9.video, 'h264');
    const audio = editRequest('audio', source(), 'x');
    assert.equal(audio.startMs, null);
    assert.equal(audio.endMs, null);
    assert.equal(audio.keyframeStart, false);
  });
});

describe('output naming', () => {
  test('the new item is named after the original with what was done', () => {
    assert.equal(editOutputTitle('Beach clip', 'trimmed'), 'Beach clip (trimmed)');
    assert.equal(editOutputTitle('  Beach clip  ', 'MP4'), 'Beach clip (MP4)');
    assert.equal(editOutputTitle('میری ویڈیو', 'آڈیو'), 'میری ویڈیو (آڈیو)');
  });

  test('an empty title uses the label; a long one is capped without splitting a character', () => {
    assert.equal(editOutputTitle('   ', 'audio'), 'audio (audio)');
    const long = editOutputTitle('🎬'.repeat(400), 'trimmed');
    assert.equal(Array.from(long).length <= MAX_EDIT_TITLE_LENGTH, true);
    assert.ok(long.endsWith(' (trimmed)'));
    assert.equal(long.includes(String.fromCharCode(0xfffd)), false);
  });
});

describe('free-space checks', () => {
  test('the estimate follows the part kept and whether the video is re-encoded', () => {
    const plan = { video: 'copy', audio: 'copy' } as const;
    assert.equal(estimateEditBytes(source(), plan), 110_000_000);
    assert.equal(estimateEditBytes(source(), plan, { startMs: 0, endMs: 30_000 }), 55_000_000);
    assert.equal(estimateEditBytes(source(), { video: 'h264', audio: 'copy' }, { startMs: 0, endMs: 30_000 }), 100_000_000);
    assert.equal(estimateEditBytes(source({ durationMs: null }), plan, { startMs: 0, endMs: 30_000 }), 110_000_000);
  });

  test('room means the output plus the margin', () => {
    assert.equal(hasRoomForEdit(EDIT_FREE_SPACE_MARGIN_BYTES + 100, 100), true);
    assert.equal(hasRoomForEdit(EDIT_FREE_SPACE_MARGIN_BYTES + 99, 100), false);
    // Unknown free space is left to the native check.
    assert.equal(hasRoomForEdit(null, 100), true);
    assert.equal(hasRoomForEdit(Number.NaN, 100), true);
  });
});

describe('trim time', () => {
  test('the player format plus tenths', () => {
    assert.equal(formatTrimTime(0), '00:00.0');
    assert.equal(formatTrimTime(61_250), '01:01.2');
    assert.equal(formatTrimTime(3_725_900), '1:02:05.9');
  });
});
