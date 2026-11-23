import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProbeResult } from '@modules/vidorax-media';

import { guessStreamContentType, isYouTubeHost, parseNetworkStreamLink, planNetworkStream } from './network-stream.ts';

const ok = (kind: string, finalUrl = 'https://cdn.example.com/final.m3u8'): ProbeResult =>
  ({
    ok: true,
    kind,
    finalUrl,
    contentType: null,
    container: 'unknown',
    sizeBytes: null,
    resumable: false,
    variants: [],
    audioTracks: [],
    durationMs: null,
  }) as unknown as ProbeResult;

const failed = (reason: string): ProbeResult =>
  ({ ok: false, reason, httpStatus: null, message: null }) as unknown as ProbeResult;

describe('P14 #663 network stream links', () => {
  it('accepts web links and adds https:// to a bare address', () => {
    assert.deepEqual(parseNetworkStreamLink('  https://example.com/a.mp4 '), { ok: true, url: 'https://example.com/a.mp4' });
    assert.deepEqual(parseNetworkStreamLink('http://example.com/live.m3u8'), { ok: true, url: 'http://example.com/live.m3u8' });
    assert.deepEqual(parseNetworkStreamLink('example.com/video.mp4'), { ok: true, url: 'https://example.com/video.mp4' });
    assert.deepEqual(parseNetworkStreamLink('media.local:8080/a.mp4'), { ok: true, url: 'https://media.local:8080/a.mp4' });
  });

  it('refuses empty text, other schemes, broken links and YouTube', () => {
    assert.deepEqual(parseNetworkStreamLink('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(parseNetworkStreamLink('ftp://example.com/a.mp4'), { ok: false, reason: 'not_http' });
    assert.deepEqual(parseNetworkStreamLink('rtsp://cam.example.com/stream'), { ok: false, reason: 'not_http' });
    assert.deepEqual(parseNetworkStreamLink('file:///sdcard/a.mp4'), { ok: false, reason: 'not_http' });
    assert.deepEqual(parseNetworkStreamLink('intent://x#Intent;end'), { ok: false, reason: 'not_http' });
    assert.deepEqual(parseNetworkStreamLink('https://exa mple.com/a.mp4'), { ok: false, reason: 'invalid' });
    for (const link of [
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'm.youtube.com/watch?v=abc',
      'https://music.youtube.com/watch?v=abc',
      'https://www.youtube-nocookie.com/embed/abc',
    ]) {
      assert.deepEqual(parseNetworkStreamLink(link), { ok: false, reason: 'youtube' }, link);
    }
    assert.equal(isYouTubeHost('notyoutube.com'), false);
    assert.equal(isYouTubeHost('youtube.com.'), true);
  });

  it('guesses the kind from the path only', () => {
    assert.equal(guessStreamContentType('https://a.com/x/master.m3u8?token=1'), 'hls');
    assert.equal(guessStreamContentType('https://a.com/manifest.mpd'), 'dash');
    assert.equal(guessStreamContentType('https://a.com/v.MP4'), 'progressive');
    assert.equal(guessStreamContentType('https://a.com/song.mp3'), 'progressive');
    assert.equal(guessStreamContentType('https://a.com/watch?id=5'), null);
    assert.equal(guessStreamContentType('not a url'), null);
  });

  it('plans from the engine probe: its kind and final address', () => {
    assert.deepEqual(planNetworkStream('https://a.com/x', ok('hls')), {
      ok: true,
      url: 'https://cdn.example.com/final.m3u8',
      contentType: 'hls',
    });
    assert.deepEqual(planNetworkStream('https://a.com/x', ok('live')), {
      ok: true,
      url: 'https://cdn.example.com/final.m3u8',
      contentType: 'hls',
    });
    assert.equal((planNetworkStream('https://a.com/x', ok('dash')) as { contentType: string }).contentType, 'dash');
    assert.equal((planNetworkStream('https://a.com/x', ok('progressive')) as { contentType: string }).contentType, 'progressive');
    assert.deepEqual(planNetworkStream('https://a.com/x', ok('split')), { ok: false, reason: 'unsupported' });
  });

  it('plays a live stream the downloader refuses, and refuses protected, blocked and broken links', () => {
    assert.deepEqual(planNetworkStream('https://a.com/live.m3u8', failed('LIVE_UNSUPPORTED')), {
      ok: true,
      url: 'https://a.com/live.m3u8',
      contentType: 'hls',
    });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('DRM_PROTECTED')), { ok: false, reason: 'drm' });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('POLICY_BLOCKED')), { ok: false, reason: 'blocked' });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('NOT_MEDIA')), { ok: false, reason: 'not_media' });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('HTTP_404')), { ok: false, reason: 'not_found' });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('HTTP_403')), { ok: false, reason: 'http' });
    assert.deepEqual(planNetworkStream('https://a.com/x', failed('NETWORK')), { ok: false, reason: 'network' });
  });

  it('falls back to the path when the probe cannot judge, or is missing', () => {
    assert.deepEqual(planNetworkStream('https://a.com/v.webm', failed('UNSUPPORTED_FORMAT')), {
      ok: true,
      url: 'https://a.com/v.webm',
      contentType: 'progressive',
    });
    assert.deepEqual(planNetworkStream('https://a.com/watch', failed('UNSUPPORTED_FORMAT')), { ok: false, reason: 'unsupported' });
    assert.deepEqual(planNetworkStream('https://a.com/a.m3u8', null), { ok: true, url: 'https://a.com/a.m3u8', contentType: 'hls' });
    assert.deepEqual(planNetworkStream('https://a.com/watch', null), { ok: true, url: 'https://a.com/watch', contentType: 'progressive' });
  });
});
