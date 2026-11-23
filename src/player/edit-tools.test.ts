/**
 * P10 Screenshot & edit tools: which source gets which tool, where Trim starts from the Player, what a screenshot is
 * called, what each edit writes, and when the Player holds the pause.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canEditInPlayer,
  canScreenshot,
  editOutputExtension,
  formatFrameStamp,
  MAX_SCREENSHOT_TITLE_LENGTH,
  parseTrimStartParam,
  playerToolSource,
  SCREENSHOT_EXTENSION,
  screenshotTitle,
  shouldHoldPause,
  trimRangeFromPosition,
  type PlayerToolSource,
} from './edit-tools';

const flags = { isStream: false, isDevice: false, isIncoming: false };

describe('what is playing', () => {
  test('streams, files from other apps, device videos, library videos', () => {
    assert.equal(playerToolSource({ mediaId: 'stream:abc', ...flags, isStream: true }), 'stream');
    assert.equal(playerToolSource({ mediaId: 'external:abc', ...flags, isIncoming: true }), 'incoming');
    assert.equal(playerToolSource({ mediaId: 'device:42', ...flags, isDevice: true }), 'device');
    assert.equal(playerToolSource({ mediaId: 'lib1', ...flags }), 'library');
    assert.equal(playerToolSource({ mediaId: null, ...flags }), 'none');
  });
});

describe('Screenshot (#675)', () => {
  const sources: PlayerToolSource[] = ['library', 'device', 'incoming', 'stream', 'none'];

  test('any file on the phone that shows video; never a stream', () => {
    assert.deepEqual(
      sources.filter((source) => canScreenshot({ source, hasVideoFrame: true, nativeAvailable: true })),
      ['library', 'device', 'incoming'],
    );
  });

  test('not for audio (no video frame) nor on a build without the frame export', () => {
    assert.equal(canScreenshot({ source: 'library', hasVideoFrame: false, nativeAvailable: true }), false);
    assert.equal(canScreenshot({ source: 'library', hasVideoFrame: true, nativeAvailable: false }), false);
  });
});

describe('the editors (#677–#680)', () => {
  test('library videos only, once the library has the item, on a build with the editor', () => {
    const yes = { source: 'library', libraryItemFound: true, isVideo: true, editorAvailable: true } as const;
    assert.equal(canEditInPlayer(yes), true);
    for (const source of ['device', 'incoming', 'stream', 'none'] as const) {
      assert.equal(canEditInPlayer({ ...yes, source }), false, source);
    }
    // A download still being played from its partial file has no library item yet.
    assert.equal(canEditInPlayer({ ...yes, libraryItemFound: false }), false);
    assert.equal(canEditInPlayer({ ...yes, editorAvailable: false }), false);
    // An audio file in the library: every tool here is for a video.
    assert.equal(canEditInPlayer({ ...yes, isVideo: false }), false);
  });

  test('every edit writes a new file: .m4a for the sound alone, .mp4 otherwise; screenshots are .jpg', () => {
    assert.equal(editOutputExtension('audio'), 'm4a');
    assert.equal(editOutputExtension('trim'), 'mp4');
    assert.equal(editOutputExtension('mp4'), 'mp4');
    assert.equal(editOutputExtension('compress'), 'mp4');
    assert.equal(SCREENSHOT_EXTENSION, 'jpg');
  });
});

describe('Trim from the Player (#677)', () => {
  test('starts at the moment playing and runs to the end', () => {
    assert.deepEqual(trimRangeFromPosition(12.34, 60_000), { startMs: 12_340, endMs: 60_000 });
    assert.deepEqual(trimRangeFromPosition(0, 60_000), { startMs: 0, endMs: 60_000 });
  });

  test('keeps at least one second: near or past the end the start moves back', () => {
    assert.deepEqual(trimRangeFromPosition(59.8, 60_000), { startMs: 59_000, endMs: 60_000 });
    assert.deepEqual(trimRangeFromPosition(75, 60_000), { startMs: 59_000, endMs: 60_000 });
    assert.deepEqual(trimRangeFromPosition(-3, 60_000), { startMs: 0, endMs: 60_000 });
    assert.deepEqual(trimRangeFromPosition(Number.NaN, 60_000), { startMs: 0, endMs: 60_000 });
  });

  test('a video under a second or of unknown length cannot be trimmed', () => {
    assert.equal(trimRangeFromPosition(0, 800), null);
    assert.equal(trimRangeFromPosition(5, null), null);
    assert.equal(trimRangeFromPosition(5, Number.NaN), null);
  });

  test('the Trim screen reads its start from the route (whole milliseconds only)', () => {
    assert.equal(parseTrimStartParam('12340'), 12_340);
    assert.equal(parseTrimStartParam(['5000', '7']), 5_000);
    assert.equal(parseTrimStartParam(undefined), null);
    assert.equal(parseTrimStartParam(''), null);
    assert.equal(parseTrimStartParam('-5'), null);
    assert.equal(parseTrimStartParam('1e3'), null);
    assert.equal(parseTrimStartParam('12.5'), null);
  });
});

describe('screenshot name', () => {
  test('the moment in minutes, seconds and tenths, with hours when needed, and no colon', () => {
    assert.equal(formatFrameStamp(725.4), '12m05.4s');
    assert.equal(formatFrameStamp(5), '0m05.0s');
    assert.equal(formatFrameStamp(3_725.46), '1h02m05.4s');
    assert.equal(formatFrameStamp(0.7), '0m00.7s');
    assert.equal(formatFrameStamp(-1), '0m00.0s');
    assert.equal(formatFrameStamp(Number.NaN), '0m00.0s');
    assert.ok(!formatFrameStamp(3_725).includes(':'));
  });

  test('"<video title> <moment>", never the file name; a fallback without a title', () => {
    assert.equal(screenshotTitle('Beach day', 725.4, 'Screenshot'), 'Beach day 12m05.4s');
    assert.equal(screenshotTitle('  ', 5, 'Screenshot'), 'Screenshot 0m05.0s');
    assert.equal(screenshotTitle(null, 5, 'اسکرین شاٹ'), 'اسکرین شاٹ 0m05.0s');
  });

  test('a long title is cut by code points, so Urdu and emoji stay whole', () => {
    const title = '🎬'.repeat(MAX_SCREENSHOT_TITLE_LENGTH + 20);
    const name = screenshotTitle(title, 1, 'Screenshot');
    assert.equal(Array.from(name.split(' ')[0]!).length, MAX_SCREENSHOT_TITLE_LENGTH);
    assert.ok(name.endsWith(' 0m01.0s'));
  });
});

describe('the pause while an edit runs', () => {
  test('held only for an edit the Player started, while it runs and the video plays', () => {
    assert.equal(shouldHoldPause({ editRunning: true, startedFromPlayer: true, isPlaying: true }), true);
    assert.equal(shouldHoldPause({ editRunning: true, startedFromPlayer: true, isPlaying: false }), false);
    assert.equal(shouldHoldPause({ editRunning: true, startedFromPlayer: false, isPlaying: true }), false);
    assert.equal(shouldHoldPause({ editRunning: false, startedFromPlayer: true, isPlaying: true }), false);
  });
});
