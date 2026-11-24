import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { __resetPrivateMediaGuardForTests, markMovedToPrivate } from '@/privacy/private-media-guard';

import { castStartPositionMs, phoneResumeAfterCast } from './cast-handover';
import { castBlockReason, castNeedsLocalServer } from './cast-rules';
import {
  INITIAL_CAST_STATE,
  castConnected,
  castConnecting,
  castDevicesChanged,
  castDisconnected,
  castFailed,
  castLoading,
  castPositionChanged,
  castStateChanged,
  isCastingMedia,
} from './cast-store';
import { assToWebVtt, cuesToWebVtt, srtToWebVtt, subtitleToWebVtt, webVttHasCues, webVttTime } from './webvtt';

describe('WebVTT for the TV', () => {
  test('times are HH:MM:SS.mmm', () => {
    assert.equal(webVttTime(0), '00:00:00.000');
    assert.equal(webVttTime(1_234), '00:00:01.234');
    assert.equal(webVttTime(3_723_045), '01:02:03.045');
    assert.equal(webVttTime(-50), '00:00:00.000');
  });

  test('SRT becomes WebVTT', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,500\r\nHello <i>there</i>\r\nsecond line\r\n\r\n2\r\n00:01:00,000 --> 00:01:01,000\r\nBye\r\n';
    assert.equal(
      srtToWebVtt(srt),
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nHello there\nsecond line\n\n00:01:00.000 --> 00:01:01.000\nBye\n',
    );
  });

  test('ASS / SSA becomes WebVTT, styling dropped', () => {
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize',
      'Style: Default,Arial,20',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:03.50,0:00:05.00,Default,,0,0,0,,{\\b1}Bold{\\b0} words\\Nnext line',
      'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First',
    ].join('\n');
    assert.equal(
      assToWebVtt(ass),
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst\n\n00:00:03.500 --> 00:00:05.000\nBold words\nnext line\n',
    );
  });

  test('the P3 sync offset moves every cue, and cues before 0:00 are dropped or cut', () => {
    const cues = [
      { startMs: 500, endMs: 1_000, text: 'gone' },
      { startMs: 1_500, endMs: 3_000, text: 'cut' },
      { startMs: 5_000, endMs: 6_000, text: 'moved' },
    ];
    assert.equal(
      cuesToWebVtt(cues, -2_000),
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ncut\n\n00:00:03.000 --> 00:00:04.000\nmoved\n',
    );
    assert.equal(cuesToWebVtt([{ startMs: 0, endMs: 1_000, text: 'later' }], 1_500), 'WEBVTT\n\n00:00:01.500 --> 00:00:02.500\nlater\n');
  });

  test('markup characters are escaped and blank lines inside a cue are removed', () => {
    assert.equal(
      cuesToWebVtt([{ startMs: 0, endMs: 1_000, text: 'a < b & c --> d\n\n  e  ' }]),
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\na &lt; b &amp; c --&gt; d\ne\n',
    );
  });

  test('empty cues are skipped, and a file with none has no cues', () => {
    const vtt = cuesToWebVtt([{ startMs: 0, endMs: 1_000, text: '   ' }, { startMs: 2_000, endMs: 2_000, text: 'x' }]);
    assert.equal(vtt, 'WEBVTT\n\n');
    assert.equal(webVttHasCues(vtt), false);
    assert.equal(webVttHasCues(srtToWebVtt('1\n00:00:01,000 --> 00:00:02,000\nHi\n')), true);
  });

  test('every format P3 reads goes through the same writer', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nHi\n';
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    assert.equal(subtitleToWebVtt(srt, 'srt'), vtt);
    assert.equal(subtitleToWebVtt(vtt, 'vtt'), vtt);
    assert.equal(subtitleToWebVtt(srt, 'srt', 1_000), 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nHi\n');
  });
});

describe('what may be cast', () => {
  beforeEach(() => {
    __resetPrivateMediaGuardForTests();
  });

  test('library, phone and incoming files can be cast', () => {
    assert.equal(castBlockReason({ mediaId: 'lib-1', uri: 'file:///data/user/0/x/files/library/web/a.mp4' }), null);
    assert.equal(castBlockReason({ mediaId: 'device:42', uri: 'content://media/external/video/media/42' }), null);
    assert.equal(castNeedsLocalServer('content://media/external/video/media/42'), true);
  });

  test('a Private Folder video is never cast', () => {
    // A vault item's own id (the vault never keeps the library id).
    assert.equal(castBlockReason({ mediaId: '123e4567-e89b-42d3-a456-426614174000', uri: 'file:///x/a.mp4' }), 'private');
    // The vault's decrypted playback copy, whatever id it plays under.
    assert.equal(
      castBlockReason({ mediaId: 'lib-1', uri: 'file:///data/user/0/x/cache/vault-play/123e4567-e89b-12d3-a456-426614174000.mp4' }),
      'private',
    );
    markMovedToPrivate('lib-2');
    assert.equal(castBlockReason({ mediaId: 'lib-2', uri: 'file:///data/user/0/x/files/library/web/b.mp4' }), 'private');
  });

  test('a download still being written waits', () => {
    assert.equal(
      castBlockReason({ mediaId: 'lib-3', uri: `content://com.vidorax.fast.videodownloader.vidorax.growing/v/${'0f'.repeat(16)}` }),
      'still_downloading',
    );
  });

  test('a stream goes by its own URL, unless it needs the page’s headers', () => {
    assert.equal(castBlockReason({ mediaId: 'stream:1', uri: 'https://cdn.example.com/a.m3u8' }), null);
    assert.equal(castBlockReason({ mediaId: 'stream:1', uri: 'https://cdn.example.com/a.m3u8', headers: {} }), null);
    assert.equal(castNeedsLocalServer('https://cdn.example.com/a.m3u8'), false);
    assert.equal(
      castBlockReason({ mediaId: 'stream:2', uri: 'https://cdn.example.com/a.mp4', headers: { Referer: 'https://site' } }),
      'stream_unsupported',
    );
  });

  test('nothing else is cast', () => {
    assert.equal(castBlockReason({ mediaId: 'x', uri: null }), 'not_castable');
    assert.equal(castBlockReason({ mediaId: 'x', uri: 'asset:///a.mp4' }), 'not_castable');
  });
});

describe('a Private Folder video is refused before anything else', () => {
  test('even when it is also a stream or a growing file', () => {
    const vaultId = '123e4567-e89b-42d3-a456-426614174000';
    assert.equal(castBlockReason({ mediaId: vaultId, uri: 'https://cdn.example.com/a.mp4' }), 'private');
    assert.equal(castBlockReason({ mediaId: vaultId, uri: 'content://x.vidorax.growing/v/1' }), 'private');
    assert.equal(castBlockReason({ mediaId: vaultId, uri: null }), 'private');
  });
});

describe('handing over between the phone and the TV', () => {
  test('the TV starts where the phone is', () => {
    assert.equal(castStartPositionMs({ positionSeconds: 83.4567, durationSeconds: 600, isCompleted: false }), 83_457);
    assert.equal(castStartPositionMs({ positionSeconds: 0, durationSeconds: null, isCompleted: false }), 0);
    assert.equal(castStartPositionMs({ positionSeconds: -3, durationSeconds: 600, isCompleted: false }), 0);
  });

  test('a finished video starts on the TV from the beginning', () => {
    assert.equal(castStartPositionMs({ positionSeconds: 600, durationSeconds: 600, isCompleted: true }), 0);
    assert.equal(castStartPositionMs({ positionSeconds: 599.5, durationSeconds: 600, isCompleted: false }), 0);
  });

  test('stopping the cast continues on the phone from the TV’s position', () => {
    assert.deepEqual(
      phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: 125_500, finished: false, durationSeconds: 600, wasCasting: true }),
      { seekSeconds: 125.5, play: true },
    );
  });

  test('a dropped connection waits on the phone, paused, at the TV’s position', () => {
    assert.deepEqual(
      phoneResumeAfterCast({ reason: 'dropped', tvPositionMs: 42_000, finished: false, durationSeconds: 600, wasCasting: true }),
      { seekSeconds: 42, play: false },
    );
    assert.deepEqual(
      phoneResumeAfterCast({ reason: 'ended', tvPositionMs: 42_000, finished: false, durationSeconds: null, wasCasting: true }),
      { seekSeconds: 42, play: false },
    );
  });

  test('the phone never seeks into the end', () => {
    assert.deepEqual(
      phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: 900_000, finished: false, durationSeconds: 600, wasCasting: true }),
      { seekSeconds: 599, play: true },
    );
  });

  test('a video the TV finished, a failed connect, or no load leave the phone as it is', () => {
    const none = { seekSeconds: null, play: false };
    assert.deepEqual(phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: 600_000, finished: true, durationSeconds: 600, wasCasting: true }), none);
    assert.deepEqual(phoneResumeAfterCast({ reason: 'failed', tvPositionMs: null, finished: false, durationSeconds: 600, wasCasting: false }), none);
    assert.deepEqual(phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: 10_000, finished: false, durationSeconds: 600, wasCasting: false }), none);
  });

  test('without a TV position the phone stays where it is', () => {
    assert.deepEqual(
      phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: null, finished: false, durationSeconds: 600, wasCasting: true }),
      { seekSeconds: null, play: true },
    );
  });

  test('both directions round-trip', () => {
    const startMs = castStartPositionMs({ positionSeconds: 300.25, durationSeconds: 1_200, isCompleted: false });
    const back = phoneResumeAfterCast({ reason: 'stopped', tvPositionMs: startMs, finished: false, durationSeconds: 1_200, wasCasting: true });
    assert.equal(back.seekSeconds, 300.25);
  });
});

describe('the cast state', () => {
  const device = { id: 'route-1', name: 'Living Room TV', description: null };

  test('devices come and go', () => {
    const found = castDevicesChanged(INITIAL_CAST_STATE, [device, { id: '', name: 'bad', description: null }]);
    assert.deepEqual(found.devices, [device]);
    assert.deepEqual(castDevicesChanged(found, []).devices, []);
  });

  test('connect, load, play and stop', () => {
    let state = castConnecting(INITIAL_CAST_STATE);
    assert.equal(state.connection, 'connecting');
    state = castConnected(state, 'Living Room TV');
    assert.equal(state.connection, 'connected');
    assert.equal(state.deviceName, 'Living Room TV');
    assert.equal(isCastingMedia(state, 'm1'), false);
    state = castLoading(state, 'm1', 83_000);
    assert.equal(isCastingMedia(state, 'm1'), true);
    assert.equal(isCastingMedia(state, 'm2'), false);
    state = castStateChanged(state, { state: 'playing', positionMs: 84_000, durationMs: 600_000, volume: 0.5 });
    assert.equal(state.media, 'playing');
    assert.equal(state.volume, 0.5);
    state = castPositionChanged(state, 90_000, 600_000);
    assert.equal(state.positionMs, 90_000);
    state = castDisconnected(state, { reason: 'stopped', positionMs: 91_000, finished: false });
    assert.equal(state.connection, 'idle');
    assert.equal(state.castMediaId, null);
    assert.deepEqual(state.lastDisconnect, { reason: 'stopped', positionMs: 91_000, finished: false, mediaId: 'm1', seq: 1 });
  });

  test('a disconnect without a position keeps the last one known', () => {
    let state = castLoading(castConnected(INITIAL_CAST_STATE, 'TV'), 'm1', 0);
    state = castPositionChanged(state, 12_000, null);
    state = castDisconnected(state, { reason: 'dropped', positionMs: null, finished: false });
    assert.equal(state.lastDisconnect?.positionMs, 12_000);
    assert.equal(castDisconnected(state, { reason: 'dropped', positionMs: null, finished: false }).lastDisconnect?.seq, 2);
  });

  test('position and state events are ignored while not connected', () => {
    assert.equal(castPositionChanged(INITIAL_CAST_STATE, 5_000, 10_000), INITIAL_CAST_STATE);
    assert.equal(castStateChanged(INITIAL_CAST_STATE, { state: 'playing', positionMs: 1, durationMs: 2, volume: 1 }), INITIAL_CAST_STATE);
  });

  test('a failed connect goes back to idle and keeps the error', () => {
    const state = castFailed(castConnecting(INITIAL_CAST_STATE), 'connect_failed');
    assert.equal(state.connection, 'idle');
    assert.equal(state.lastError?.code, 'connect_failed');
    const later = castFailed(castConnected(state, 'TV'), 'load_failed');
    assert.equal(later.connection, 'connected');
    assert.equal(later.lastError?.seq, 2);
  });
});
