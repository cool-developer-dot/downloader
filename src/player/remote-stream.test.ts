import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import type { MediaRequestContext } from '@/downloads/types/request-context';

import { assertSafeMediaId } from './media-id';
import {
  buildRemoteStream,
  chooseHlsVariant,
  classifyStreamError,
  forgetRemoteStreamsForTests,
  isPlayableOffer,
  isStreamMediaId,
  playsChosenQuality,
  knownRemoteStream,
  MAX_REMEMBERED_STREAMS,
  rememberRemoteStream,
  streamContentType,
  streamHeaders,
  streamTitle,
  streamUnavailableReason,
  streamUsesCookies,
  type StreamableOption,
} from './remote-stream';
import { resolvePlaybackSource, type ResolvePlaybackSourceDeps } from './resolve-playback-source';
import { PlaybackError } from './errors';

afterEach(() => forgetRemoteStreamsForTests());

function option(overrides: Partial<StreamableOption> = {}): StreamableOption {
  return {
    sourceUrl: 'https://cdn.example.com/v/clip-720.mp4',
    downloadable: true,
    streamType: 'PROGRESSIVE',
    isHls: false,
    container: 'mp4',
    audioSourceUrl: null,
    ...overrides,
  };
}

function context(overrides: Partial<MediaRequestContext> = {}): MediaRequestContext {
  return {
    pageUrl: 'https://www.example.com/watch/1',
    referer: 'https://www.example.com/',
    userAgent: 'Mozilla/5.0 (Linux; Android 15) Mobile',
    cookiesRequired: true,
    hasCookies: true,
    headers: {},
    capturedAt: 1,
    ...overrides,
  };
}

test('content type: HLS by flag, stream type or container; DASH; anything else is a single file', () => {
  assert.equal(streamContentType(option({ isHls: true })), 'hls');
  assert.equal(streamContentType(option({ streamType: 'HLS' })), 'hls');
  assert.equal(streamContentType(option({ container: 'hls' })), 'hls');
  assert.equal(streamContentType(option({ streamType: 'DASH', container: 'mp4' })), 'dash');
  assert.equal(streamContentType(option({ container: 'dash' })), 'dash');
  assert.equal(streamContentType(option()), 'progressive');
  assert.equal(streamContentType(option({ streamType: 'AUDIO', container: 'mp3' })), 'progressive');
});

test('split audio + video, refused and non-http offers have no Play', () => {
  assert.equal(streamUnavailableReason(option({ audioSourceUrl: 'https://cdn.example.com/a.mp4' })), 'split');
  assert.equal(streamUnavailableReason(option({ downloadable: false })), 'not_downloadable');
  assert.equal(streamUnavailableReason(option({ sourceUrl: 'blob:https://www.example.com/abc' })), 'no_url');
  assert.equal(streamUnavailableReason(null), 'not_downloadable');
  // F6: a live stream is offered for recording, not for online play.
  assert.equal(streamUnavailableReason(option({ isHls: true, isLive: true })), 'live');
  assert.equal(isPlayableOffer(option()), true);
  assert.equal(isPlayableOffer(option({ isHls: true, sourceUrl: 'https://cdn.example.com/master.m3u8' })), true);
  const split = buildRemoteStream({
    option: option({ audioSourceUrl: 'https://cdn.example.com/a.mp4' }),
    requestContext: context(),
    offerTitle: 'Reel',
    pageUrl: 'https://www.instagram.com/reel/x/',
    thumbnailUrl: null,
  });
  assert.deepEqual(split, { ok: false, reason: 'split' });
});

test('an HLS variant or a file plays as chosen; a DASH manifest adapts, so it gets one Play, not one per quality', () => {
  assert.equal(playsChosenQuality(option({ isHls: true, sourceUrl: 'https://cdn.example.com/480/index.m3u8' })), true);
  assert.equal(playsChosenQuality(option()), true);
  assert.equal(playsChosenQuality(option({ streamType: 'DASH', sourceUrl: 'https://cdn.example.com/a.mpd' })), false);
  assert.equal(isPlayableOffer(option({ streamType: 'DASH', sourceUrl: 'https://cdn.example.com/a.mpd' })), true);
  assert.equal(playsChosenQuality(option({ audioSourceUrl: 'https://cdn.example.com/a.mp4' })), false);
});

test('headers: User-Agent, Referer, Origin and Cookie from the page (any case); nothing else', () => {
  const headers = streamHeaders(
    context({
      headers: {
        'user-agent': 'UA-from-headers',
        referer: 'https://www.example.com/watch/1',
        ORIGIN: 'https://www.example.com',
        cookie: 'session=abc; region=pk',
        Range: 'bytes=0-',
        Accept: '*/*',
      },
    }),
  );
  assert.deepEqual(headers, {
    'User-Agent': 'UA-from-headers',
    Referer: 'https://www.example.com/watch/1',
    Origin: 'https://www.example.com',
    Cookie: 'session=abc; region=pk',
  });
});

test('headers: the context’s own Referer / User-Agent when the header map lacks them; none without a context', () => {
  assert.deepEqual(streamHeaders(context()), {
    'User-Agent': 'Mozilla/5.0 (Linux; Android 15) Mobile',
    Referer: 'https://www.example.com/',
  });
  assert.deepEqual(streamHeaders(null), {});
  assert.deepEqual(streamHeaders(context({ referer: null, userAgent: null })), {});
});

test('headers: like the download engine, the Referer falls back to the page; cookies follow the engine’s rule', () => {
  assert.deepEqual(streamHeaders(context({ referer: null, userAgent: null }), 'https://www.tiktok.com/@a/video/1'), {
    Referer: 'https://www.tiktok.com/@a/video/1',
  });
  assert.equal(streamUsesCookies(context({ cookiesRequired: true, hasCookies: false })), true);
  assert.equal(streamUsesCookies(context({ cookiesRequired: false, hasCookies: true })), true);
  assert.equal(streamUsesCookies(context({ cookiesRequired: false, hasCookies: false })), false);
  assert.equal(streamUsesCookies(null), false);
  const built = buildRemoteStream({
    option: option(),
    requestContext: context({ referer: null, headers: {} }),
    offerTitle: 'TikTok',
    pageUrl: 'https://www.tiktok.com/@a/video/1',
    thumbnailUrl: null,
    cookieHeader: ' tt_chain_token=abc ',
  });
  assert.ok(built.ok);
  assert.equal(built.stream.headers.Cookie, 'tt_chain_token=abc');
  assert.equal(built.stream.headers.Referer, 'https://www.tiktok.com/@a/video/1');
});

test('title: a page offer keeps its title; a file or manifest opened directly is titled by its file name', () => {
  // The tab's previous page title must never become the stream's title (Prompt A / F1 "Found, not fixed").
  assert.equal(
    streamTitle({
      offerTitle: 'NASA on Facebook — Artemis II recap',
      pageUrl: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
      mediaUrl: 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    }),
    'bbb_30fps.mpd',
  );
  assert.equal(
    streamTitle({
      offerTitle: 'Old page title',
      pageUrl: 'https://upload.wikimedia.org/x/Elephants_Dream_%282006%29.webm.720p.vp9.webm',
      mediaUrl: 'https://upload.wikimedia.org/x/Elephants_Dream_%282006%29.webm.720p.vp9.webm?signed=1',
    }),
    'Elephants_Dream_(2006).webm.720p.vp9.webm',
  );
  assert.equal(
    streamTitle({
      offerTitle: '  Big Buck Bunny  ',
      pageUrl: 'https://www.example.com/watch/1',
      mediaUrl: 'https://cdn.example.com/v/clip-720.mp4',
    }),
    'Big Buck Bunny',
  );
  assert.equal(
    streamTitle({ offerTitle: '', pageUrl: 'https://www.example.com/watch/1', mediaUrl: 'https://cdn.example.com/v/clip-720.mp4' }),
    'clip-720.mp4',
  );
  assert.equal(
    streamTitle({ offerTitle: null, pageUrl: 'https://www.example.com/watch/1', mediaUrl: 'https://cdn.example.com/' }),
    'www.example.com',
  );
});

test('a built stream carries the fresh URL, the headers, the type and an http thumbnail only', () => {
  const built = buildRemoteStream({
    option: option({ isHls: true, sourceUrl: 'https://cdn.example.com/master.m3u8?sig=old' }),
    sourceUrl: 'https://cdn.example.com/master.m3u8?sig=new',
    requestContext: context({ headers: { Cookie: 'a=1' } }),
    offerTitle: 'Live page',
    pageUrl: 'https://www.example.com/watch/1',
    thumbnailUrl: 'data:image/png;base64,xx',
  });
  assert.ok(built.ok);
  assert.equal(built.stream.uri, 'https://cdn.example.com/master.m3u8?sig=new');
  assert.equal(built.stream.contentType, 'hls');
  assert.equal(built.stream.headers.Cookie, 'a=1');
  assert.equal(built.stream.title, 'Live page');
  assert.equal(built.stream.thumbnailUrl, null);
});

test('registry: ids are opaque, route-safe and only known for this run; the oldest go first', () => {
  const built = buildRemoteStream({
    option: option(),
    requestContext: context(),
    offerTitle: 'One',
    pageUrl: 'https://www.example.com/watch/1',
    thumbnailUrl: 'https://i.example.com/t.jpg',
  });
  assert.ok(built.ok);
  const id = rememberRemoteStream(built.stream);
  assert.match(id, /^stream:[0-9a-f]{32}$/);
  assert.equal(assertSafeMediaId(id), id, 'passes the route guard');
  assert.equal(isStreamMediaId(id), true);
  assert.equal(isStreamMediaId('external:0123456789abcdef0123456789abcdef'), false);
  assert.equal(knownRemoteStream(id)?.title, 'One');
  assert.equal(knownRemoteStream('stream:not-a-token'), null);
  assert.equal(knownRemoteStream(`stream:${'0'.repeat(32)}`), null);

  const ids = Array.from({ length: MAX_REMEMBERED_STREAMS }, () => rememberRemoteStream(built.stream));
  assert.equal(knownRemoteStream(id), null, 'the oldest was dropped');
  assert.ok(knownRemoteStream(ids[ids.length - 1]));
});

test('errors: refused links are expired; failed connections are the network; anything else is not stream-specific', () => {
  const exo = (cause: string) => ({ message: `A playback exception has occurred: Source error ${cause}` });
  assert.equal(classifyStreamError(exo('Response code: 403')), 'STREAM_LINK_EXPIRED');
  assert.equal(classifyStreamError(exo('Response code: 410')), 'STREAM_LINK_EXPIRED');
  assert.equal(classifyStreamError(exo('Response code: 404')), 'STREAM_LINK_EXPIRED');
  assert.equal(classifyStreamError(exo('Response code: 401')), 'STREAM_LINK_EXPIRED');
  assert.equal(classifyStreamError(exo('Unable to connect')), 'STREAM_NETWORK_ERROR');
  assert.equal(
    classifyStreamError(exo('java.net.UnknownHostException: Unable to resolve host "cdn.example.com"')),
    'STREAM_NETWORK_ERROR',
  );
  assert.equal(classifyStreamError(exo('java.net.SocketTimeoutException: timeout')), 'STREAM_NETWORK_ERROR');
  // Seen on the device when the server went away mid-play (OkHttpDataSource).
  assert.equal(
    classifyStreamError(
      exo(
        'java.io.IOException: java.util.concurrent.ExecutionException: java.io.IOException: unexpected end of stream on http://fx.127.0.0.1.nip.io:8765/...',
      ),
    ),
    'STREAM_NETWORK_ERROR',
  );
  assert.equal(
    classifyStreamError(exo('Input does not start with the #EXTM3U header.{contentIsMalformed=true, dataType=4}')),
    null,
  );
  assert.equal(classifyStreamError(exo('Response code: 500')), null);
  assert.equal(classifyStreamError(exo('None of the available extractors could read the stream')), null);
  assert.equal(classifyStreamError(null), null);
});

function deps(overrides: Partial<ResolvePlaybackSourceDeps> = {}): ResolvePlaybackSourceDeps {
  const fail = () => {
    throw new Error('a stream must not touch the library');
  };
  return {
    getLocalRecord: async () => fail(),
    assessFile: () => fail(),
    assertManagedPath: () => fail(),
    verifyFile: () => fail(),
    reconcileAvailability: async () => fail(),
    invalidateAvailability: () => fail(),
    isCompletedStatus: () => false,
    isTempOrWorkspaceArtifact: () => false,
    normalizeMimeType: () => null,
    resolveDisplayName: () => null,
    getRemoteStream: knownRemoteStream,
    ...overrides,
  };
}

test('the player resolves a stream from the registry, with headers and type, never from the library', async () => {
  const built = buildRemoteStream({
    option: option({ streamType: 'DASH', sourceUrl: 'https://dash.example.com/a.mpd' }),
    requestContext: context({ headers: { Referer: 'https://www.example.com/watch/1' } }),
    offerTitle: 'DASH clip',
    pageUrl: 'https://www.example.com/watch/1',
    thumbnailUrl: 'https://i.example.com/t.jpg',
  });
  assert.ok(built.ok);
  const id = rememberRemoteStream(built.stream);
  const source = await resolvePlaybackSource(id, deps());
  assert.deepEqual(source, {
    mediaId: id,
    uri: 'https://dash.example.com/a.mpd',
    displayName: 'DASH clip',
    mimeType: null,
    headers: { Referer: 'https://www.example.com/watch/1', 'User-Agent': 'Mozilla/5.0 (Linux; Android 15) Mobile' },
    contentType: 'dash',
    artworkUrl: 'https://i.example.com/t.jpg',
    remote: true,
  });
});

test('a stream id from an earlier app run asks for the page again', async () => {
  await assert.rejects(
    resolvePlaybackSource(`stream:${'a'.repeat(32)}`, deps()),
    (error: unknown) => error instanceof PlaybackError && error.code === 'STREAM_LINK_EXPIRED',
  );
});

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=2882792,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  '720/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=776440,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
  '360/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
  '360-low/index.m3u8',
  '',
].join('\n');

test('HLS: a master plays the chosen variant (exact height, else the tallest below; nearest bandwidth)', () => {
  const url = 'https://cdn.example.com/hls/master.m3u8?sig=1';
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: 720, bitrate: null }), {
    url: 'https://cdn.example.com/hls/720/index.m3u8',
  });
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: 360, bitrate: 776440 }), {
    url: 'https://cdn.example.com/hls/360/index.m3u8',
  });
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: 360, bitrate: 480000 }), {
    url: 'https://cdn.example.com/hls/360-low/index.m3u8',
  });
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: 480, bitrate: null }), {
    url: 'https://cdn.example.com/hls/360/index.m3u8',
  });
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: 240, bitrate: null }), { url: null, reason: 'no_match' });
  assert.deepEqual(chooseHlsVariant(MASTER, url, { height: null, bitrate: null }), { url: null, reason: 'no_match' });
});

test('HLS: a media playlist plays as it is; a separate audio rendition keeps the master (a variant alone is silent)', () => {
  const media = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.ts\n#EXT-X-ENDLIST\n';
  assert.deepEqual(chooseHlsVariant(media, 'https://cdn.example.com/hls/360/index.m3u8', { height: 360, bitrate: null }), {
    url: null,
    reason: 'not_master',
  });
  const withAudio = MASTER.replace(
    '#EXTM3U\n',
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",DEFAULT=YES,URI="audio/en.m3u8"\n',
  );
  assert.deepEqual(chooseHlsVariant(withAudio, 'https://cdn.example.com/hls/master.m3u8', { height: 360, bitrate: null }), {
    url: null,
    reason: 'separate_audio',
  });
  assert.deepEqual(chooseHlsVariant('not a playlist', 'https://cdn.example.com/x', { height: 360, bitrate: null }), {
    url: null,
    reason: 'not_master',
  });
});
