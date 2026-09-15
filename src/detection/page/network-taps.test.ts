import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadDetector } from './test-harness.ts';

const PAGE = 'https://www.example.com/watch/42';
const VIDEO_JSON = JSON.stringify({ media: { '@type': 'VideoObject', contentUrl: 'https://cdn.example.com/v/42.mp4' } });

function page() {
  return loadDetector({ url: PAGE, readyState: 'complete' });
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(encoder.encode(chunks[index++]));
      else controller.close();
    },
  });
}

describe('fetch tap', () => {
  test('the page gets its own response with an unread body; the detector reads a clone', async () => {
    const detector = page();
    const response = await detector.fetch('https://www.example.com/api/watch/42', { contentType: 'application/json', body: VIDEO_JSON });
    await detector.settle(300);
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), VIDEO_JSON);
    assert.equal(detector.tapStats.clones, 1);
    assert.deepEqual(
      detector.candidates().map((candidate) => candidate.key),
      ['url:https://cdn.example.com/v/42.mp4'],
    );
  });

  test('responses that cannot describe media are never cloned', async () => {
    const detector = page();
    await detector.fetch('https://www.example.com/api/avatar.jpg', { contentType: 'image/jpeg', body: VIDEO_JSON });
    await detector.fetch('https://www.example.com/api/segment-1.m4s', { contentType: 'video/mp4', body: VIDEO_JSON });
    await detector.fetch('https://www.example.com/static/bundle.js', { contentType: 'application/javascript', body: VIDEO_JSON });
    await detector.fetch('https://www.example.com/about', { contentType: 'text/html', body: VIDEO_JSON });
    await detector.settle(300);
    assert.equal(detector.tapStats.clones, 0);
    assert.deepEqual(detector.candidates(), []);
  });

  test('allowlisted endpoints are read whatever text type they are served as', async () => {
    const detector = page();
    await detector.fetch('https://www.example.com/graphql?doc_id=1', { contentType: 'text/plain', body: VIDEO_JSON });
    await detector.settle(300);
    assert.equal(detector.tapStats.clones, 1);
    assert.equal(detector.candidates().length, 1);
  });

  test('a body over 4 MB is abandoned and its clone cancelled, while the page still receives all of it', async () => {
    const detector = page();
    const megabyte = 'x'.repeat(1024 * 1024);
    const chunks = ['{"media":{"@type":"VideoObject","contentUrl":"https://cdn.example.com/big.mp4","pad":"', megabyte, megabyte, megabyte, megabyte, megabyte, '"}}'];
    const response = await detector.fetch('https://www.example.com/api/big', { contentType: 'application/json', body: streamOf(chunks) });
    await detector.settle(300);
    assert.equal(detector.tapStats.cancels, 1);
    assert.deepEqual(detector.candidates(), []);
    assert.equal((await response.text()).length, chunks.join('').length);
  });

  test('a declared Content-Length over 4 MB is skipped without cloning', async () => {
    const detector = page();
    await detector.fetch('https://www.example.com/api/big', {
      contentType: 'application/json',
      headers: { 'content-length': String(5 * 1024 * 1024) },
      body: VIDEO_JSON,
    });
    assert.equal(detector.tapStats.clones, 0);
  });
});

describe('XMLHttpRequest tap', () => {
  test("reads '' and 'text' bodies and 'json' objects without changing them", async () => {
    const detector = page();
    const text = await detector.xhr({ url: 'https://www.example.com/api/a', contentType: 'application/json', body: VIDEO_JSON });
    const json = await detector.xhr({
      url: 'https://www.example.com/api/b',
      responseType: 'json',
      contentType: 'application/json',
      body: VIDEO_JSON.replace('42.mp4', '43.mp4'),
    });
    await detector.settle(300);
    assert.equal(text.responseText, VIDEO_JSON);
    assert.deepEqual(json.response, JSON.parse(VIDEO_JSON.replace('42.mp4', '43.mp4')));
    assert.deepEqual(
      detector.candidates().map((candidate) => candidate.key),
      ['url:https://cdn.example.com/v/42.mp4', 'url:https://cdn.example.com/v/43.mp4'],
    );
  });

  test('never touches arraybuffer, blob or document responses', async () => {
    const detector = page();
    const requests = await Promise.all(
      (['arraybuffer', 'blob', 'document'] as const).map((responseType) =>
        detector.xhr({ url: 'https://www.example.com/api/c', responseType, contentType: 'application/json', body: VIDEO_JSON }),
      ),
    );
    await detector.settle(300);
    assert.deepEqual(
      requests.map((request) => request.bodyReads),
      [0, 0, 0],
    );
    assert.deepEqual(detector.candidates(), []);
  });
});

describe('manifest bodies', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="English",DEFAULT=YES,URI="audio/index.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aac"',
    '720p/index.m3u8',
  ].join('\n');
  const mediaPlaylist = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg-1.ts\n#EXT-X-ENDLIST\n';

  test('HLS is recognised by content; renditions of a reported master are not separate videos', async () => {
    const detector = page();
    await detector.fetch('https://cdn.example.com/stream/master', { contentType: 'application/vnd.apple.mpegurl', body: master });
    await detector.fetch('https://cdn.example.com/stream/720p/index.m3u8', { contentType: 'application/vnd.apple.mpegurl', body: mediaPlaylist });
    await detector.fetch('https://cdn.example.com/stream/audio/index.m3u8', { contentType: 'application/vnd.apple.mpegurl', body: mediaPlaylist });
    await detector.fetch('https://other.example.com/vod/index.m3u8', { contentType: 'text/plain', body: mediaPlaylist });
    await detector.settle(300);
    assert.deepEqual(
      detector.candidates().map((candidate) => [candidate.key, candidate.sources[0].kind, candidate.provenance]),
      [
        ['url:https://cdn.example.com/stream/master', 'hls', 'manifest-body'],
        ['url:https://other.example.com/vod/index.m3u8', 'hls', 'manifest-body'],
      ],
    );
  });

  test('DASH by URL, and inline manifest text when the page served the MPD from a blob: URL', async () => {
    const mpd = '<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period/></MPD>';
    const detector = page();
    await detector.fetch('https://cdn.example.com/v/manifest.mpd', { contentType: 'application/dash+xml', body: mpd });
    await detector.fetch('blob:https://www.example.com/0b7c9e1a', { body: mpd });
    await detector.settle(300);
    const [byUrl, inline] = detector.candidates();
    assert.deepEqual(byUrl.sources, [{ kind: 'dash', url: 'https://cdn.example.com/v/manifest.mpd' }]);
    assert.match(inline.key, /^url:https:\/\/www\.example\.com\/watch\/42#mpd-/);
    assert.deepEqual(inline.sources, [{ kind: 'dash', url: PAGE, manifestText: mpd }]);
  });
});
