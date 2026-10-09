import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { extractPageMedia } from './extract-page-media';

const page = (head: string, body = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const json = (value: unknown) => `<script type="application/json">${JSON.stringify(value)}</script>`;

const MPD = (opts: { protectedSet?: boolean; dynamic?: boolean } = {}) =>
  `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="${opts.dynamic ? 'dynamic' : 'static'}" mediaPresentationDuration="PT33.6S"><Period>` +
  `<AdaptationSet mimeType="video/mp4">${opts.protectedSet ? '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc"/>' : ''}` +
  '<Representation id="v1" codecs="avc1.4d401f" width="720" height="1280" bandwidth="900000"><BaseURL>https://cdn.example/v720.mp4?sig=a&amp;x=1</BaseURL><SegmentBase indexRange="0-100"/></Representation>' +
  '<Representation id="v2" codecs="avc1.640028" width="1080" height="1920" bandwidth="2000000"><BaseURL>https://cdn.example/v1080.mp4?sig=b</BaseURL></Representation>' +
  '</AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a1" codecs="mp4a.40.2" bandwidth="96000"><BaseURL>https://cdn.example/a.mp4?sig=c</BaseURL></Representation></AdaptationSet>' +
  '</Period></MPD>';

describe('declared video (the page names its own video)', () => {
  test('og:video on a direct MP4 page', () => {
    const result = extractPageMedia({
      html: page(
        '<meta property="og:title" content="Sunset &amp; sea"><meta property="og:image" content="https://img.example/t.jpg">' +
          '<meta property="og:video:secure_url" content="https://cdn.example/clip.mp4?token=1"><meta property="og:video:type" content="video/mp4">',
      ),
      pageUrl: 'https://site.example/watch/abc123',
    });
    assert.equal(result.title, 'Sunset & sea');
    assert.equal(result.thumbnailUrl, 'https://img.example/t.jpg');
    assert.equal(result.candidates.length, 1);
    assert.deepEqual(
      [result.candidates[0]!.url, result.candidates[0]!.kind, result.candidates[0]!.evidence],
      ['https://cdn.example/clip.mp4?token=1', 'progressive', 'declared'],
    );
    assert.equal(result.ambiguous, false);
  });

  test('an og:video player page is a page to read, not a file', () => {
    const result = extractPageMedia({
      html: page('<meta property="og:video" content="https://player.example/embed/77"><meta property="og:video:type" content="text/html">'),
      pageUrl: 'https://site.example/v/77abc1',
    });
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.playerPageUrls, ['https://player.example/embed/77']);
  });

  test('JSON-LD VideoObject contentUrl, with its metadata', () => {
    const ld = { '@context': 'https://schema.org', '@type': 'VideoObject', name: 'Talk', contentUrl: '/media/talk.webm', thumbnailUrl: 'https://img.example/talk.jpg', duration: 'PT1M30S' };
    const result = extractPageMedia({
      html: page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`),
      pageUrl: 'https://site.example/talks/42abc',
    });
    assert.equal(result.candidates[0]?.url, 'https://site.example/media/talk.webm');
    assert.equal(result.candidates[0]?.evidence, 'declared');
    assert.equal(result.candidates[0]?.origin, 'json_ld');
    assert.equal(result.durationMs, 90_000);
    assert.equal(result.title, 'Talk');
  });

  test('of several VideoObjects only the one naming the pasted content speaks for the page', () => {
    const graph = {
      '@graph': [
        { '@type': 'VideoObject', url: 'https://site.example/v/other999', contentUrl: 'https://cdn.example/other.mp4' },
        { '@type': 'VideoObject', url: 'https://site.example/v/mine123', contentUrl: 'https://cdn.example/mine.mp4' },
      ],
    };
    const result = extractPageMedia({
      html: page(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`),
      pageUrl: 'https://site.example/v/mine123',
    });
    assert.deepEqual(result.candidates.map((c) => c.url), ['https://cdn.example/mine.mp4']);
  });

  test('a live broadcast is flagged', () => {
    const ld = { '@type': 'VideoObject', contentUrl: 'https://cdn.example/live/index.m3u8', publication: { '@type': 'BroadcastEvent', isLiveBroadcast: true } };
    const result = extractPageMedia({ html: page(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`), pageUrl: 'https://tv.example/live/ch1x9' });
    assert.equal(result.live, true);
    assert.equal(result.candidates[0]?.kind, 'hls');
  });
});

describe('manifests and separate audio/video', () => {
  test('HLS manifest discovery from embedded data', () => {
    const result = extractPageMedia({
      html: page(json({ video: { id: 'vid12345', title: 'x', hls_url: 'https://stream.example/vid12345/master.m3u8?t=9' } })),
      pageUrl: 'https://site.example/video/vid12345',
    });
    assert.equal(result.candidates[0]?.kind, 'hls');
    assert.equal(result.candidates[0]?.evidence, 'content');
  });

  test('DASH manifest discovery from embedded data', () => {
    const result = extractPageMedia({
      html: page(json({ item: { id: '98765432', dash_manifest_url: 'https://cdn.example/98765432/manifest.mpd' } })),
      pageUrl: 'https://site.example/watch?v=98765432',
    });
    assert.equal(result.candidates[0]?.kind, 'dash');
    assert.equal(result.candidates[0]?.url, 'https://cdn.example/98765432/manifest.mpd');
  });

  test('an inline DASH manifest becomes a split pair: its best video file with its audio file', () => {
    const result = extractPageMedia({
      html: page(json({ media: { code: 'AbCdEfGh12', video_dash_manifest: MPD() } })),
      pageUrl: 'https://social.example/reel/AbCdEfGh12/',
    });
    const split = result.candidates.find((c) => c.kind === 'split');
    assert.ok(split);
    assert.equal(split.url, 'https://cdn.example/v1080.mp4?sig=b');
    assert.equal(split.audioUrl, 'https://cdn.example/a.mp4?sig=c');
    assert.equal(split.height, 1920);
    assert.equal(split.durationMs, 33_600);
  });

  test('an inline manifest with ContentProtection marks the page protected', () => {
    const result = extractPageMedia({
      html: page(json({ media: { code: 'AbCdEfGh12', video_dash_manifest: MPD({ protectedSet: true }) } })),
      pageUrl: 'https://social.example/reel/AbCdEfGh12/',
    });
    assert.equal(result.protected, true);
  });

  test('a one-track representation described as data is never offered as the video', () => {
    const data = {
      video: {
        id: '55512345',
        playable_url: 'https://cdn.example/muxed.mp4?x=1',
        representations: [
          { representation_id: '1v', mime_type: 'video/mp4', codecs: 'avc1.64', base_url: 'https://cdn.example/rep-video.mp4' },
          { representation_id: '1a', mime_type: 'audio/mp4', codecs: 'mp4a.40.2', base_url: 'https://cdn.example/rep-audio.mp4' },
        ],
      },
    };
    const result = extractPageMedia({ html: page(json(data)), pageUrl: 'https://site.example/videos/55512345/' });
    assert.deepEqual(result.candidates.map((c) => c.url), ['https://cdn.example/muxed.mp4?x=1']);
  });
});

describe('embedded data tied to the pasted content', () => {
  test('a URL whose object carries the link\'s id is the page\'s video; a feed of other items is not', () => {
    const data = {
      data: {
        item: { shortcode: 'Qw3rTyUiOp', video_versions: [{ type: 101, url: 'https://cdn.example/o1/main.mp4?oh=1' }] },
        related: [
          { shortcode: 'Zx9cVbNmLk', video_versions: [{ url: 'https://cdn.example/o1/rel1.mp4' }] },
          { shortcode: 'Po1uYtReWq', video_versions: [{ url: 'https://cdn.example/o1/rel2.mp4' }] },
        ],
      },
    };
    const result = extractPageMedia({ html: page(json(data)), pageUrl: 'https://social.example/reel/Qw3rTyUiOp/' });
    assert.deepEqual(result.candidates.map((c) => c.url), ['https://cdn.example/o1/main.mp4?oh=1']);
    assert.equal(result.candidates[0]?.evidence, 'content');
  });

  test('a single related item with its own id is another video, whatever it links back to', () => {
    const data = {
      page: { url: 'https://social.example/reel/Qw3rTyUiOp/' },
      next: { shortcode: 'Zx9cVbNmLk', origin: 'https://social.example/reel/Qw3rTyUiOp/', video_url: 'https://cdn.example/next.mp4' },
    };
    const result = extractPageMedia({ html: page(json(data)), pageUrl: 'https://social.example/reel/Qw3rTyUiOp/' });
    assert.equal(result.candidates.length, 0);
  });

  test('an extensionless play address named by its MIME query; music and covers are not video', () => {
    const data = {
      detail: {
        itemInfo: {
          itemStruct: {
            id: '7123456789012345678',
            video: {
              cover: 'https://img.example/cover.jpeg',
              playAddr: 'https://v16.example.com/video/tos/abc/?a=1&mime_type=video_mp4&br=2188',
            },
            music: { playUrl: 'https://sf.example.com/obj/music/7123' },
          },
        },
      },
    };
    const result = extractPageMedia({
      html: `<html><body><script id="api-data" type="application/json">${JSON.stringify(data)}</script></body></html>`,
      pageUrl: 'https://short.example/@someone/video/7123456789012345678',
    });
    assert.deepEqual(result.candidates.map((c) => [c.url, c.kind]), [
      ['https://v16.example.com/video/tos/abc/?a=1&mime_type=video_mp4&br=2188', 'progressive'],
    ]);
  });

  test('element data attributes: the element whose id is the page\'s own, not a related one pointing back', () => {
    const main = `<div data-video-id="2289516264908285" data-store="{&quot;video_id&quot;:&quot;2289516264908285&quot;}" data-video-url="https://cdn.example/main.mp4?oh=1"></div>`;
    const related = `<div data-store="{&quot;video_id&quot;:&quot;1376350954687257&quot;,&quot;origin_uri&quot;:&quot;https://m.site.example/watch/?v=2289516264908285&quot;}" data-video-url="https://cdn.example/related.mp4?oh=2"></div>`;
    const result = extractPageMedia({ html: page('', main + related), pageUrl: 'https://m.site.example/watch/?v=2289516264908285' });
    assert.deepEqual(result.candidates.map((c) => c.url), ['https://cdn.example/main.mp4?oh=1']);
  });

  test('a JSON object assigned in a script is read without running it', () => {
    const script = `<script>window.__STATE__ = ${JSON.stringify({ clip: { id: 'clip77aa1', video_url: 'https://cdn.example/clip77aa1.mp4' } })};</script>`;
    const result = extractPageMedia({ html: page('', script), pageUrl: 'https://site.example/clip/clip77aa1' });
    assert.equal(result.candidates[0]?.url, 'https://cdn.example/clip77aa1.mp4');
  });
});

describe('plain HTML5 pages and ambiguity', () => {
  test('one <video> element with two sources is the page\'s single video', () => {
    const body = '<video controls width="640"><source src="/media/movie.mp4" type="video/mp4"><source src="/media/movie.ogv" type="video/ogg"></video>';
    const result = extractPageMedia({ html: page('<title>Demo</title>', body), pageUrl: 'https://docs.example/html/video.asp' });
    assert.deepEqual(result.candidates.map((c) => [c.url, c.evidence]), [
      ['https://docs.example/media/movie.mp4', 'single'],
      ['https://docs.example/media/movie.ogv', 'single'],
    ]);
    assert.equal(result.title, 'Demo');
  });

  test('two unrelated videos and nothing tying either to the page: ambiguous, nothing offered', () => {
    const body = '<video src="https://cdn.example/a.mp4"></video><video src="https://cdn.example/b.mp4"></video>';
    const result = extractPageMedia({ html: page('', body), pageUrl: 'https://blog.example/post/hello-world' });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.ambiguous, true);
  });

  test('metadata only (an image, no video): nothing', () => {
    const result = extractPageMedia({
      html: page('<meta property="og:type" content="video.other"><meta property="og:image" content="https://img.example/p.jpg">'),
      pageUrl: 'https://social.example/p/AbCdEfGh12/',
    });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.ambiguous, false);
    assert.equal(result.thumbnailUrl, 'https://img.example/p.jpg');
  });

  test('invalid HTML never throws and never invents a source', () => {
    for (const html of ['', '<<<>>>', '<meta property="og:video" content="', '<video src="javascript:alert(1)"><source src="blob:https://x/1">', '<script type="application/json">{"a":</script>', '\u0000￿<div data-video-url="data:video/mp4;base64,AA">']) {
      const result = extractPageMedia({ html, pageUrl: 'https://site.example/v/abc123' });
      assert.equal(result.candidates.length, 0, html);
    }
  });

  test('site roots, artwork and links back into the page\'s own site are not videos', () => {
    const data = {
      entry: {
        id: 'abc12345',
        manifest: 'https://static.example.com/',
        thumbnail_url: 'https://img.example/x.mp4.jpg',
        video: { url: 'https://site.example/v/abc12345', poster: 'https://img.example/poster.png' },
      },
    };
    const result = extractPageMedia({ html: page(json(data)), pageUrl: 'https://site.example/v/abc12345' });
    assert.equal(result.candidates.length, 0);
  });
});
