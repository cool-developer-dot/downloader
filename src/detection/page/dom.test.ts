import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PlayerHint } from '../types.ts';
import { loadDetector } from './test-harness.ts';

const LINKEDIN_URL = 'https://dms.licdn.com/playlist/vid/v2/D5605AQ/mp4-720p-30fp-crf28/0?e=1757100000&v=beta&t=signature';

describe('page data and DOM', () => {
  test('JSON-LD VideoObject, og:video, <video>/<source> and video[data-sources]; blob: sources skipped', async () => {
    const page = loadDetector({
      url: 'https://news.example.org/story/1',
      title: 'Story title',
      elements: [
        { tag: 'meta', attrs: { property: 'og:title', content: 'OG title' } },
        { tag: 'meta', attrs: { property: 'og:video:secure_url', content: 'https://media.example.org/clips/og.mp4' } },
        { tag: 'meta', attrs: { property: 'og:video:type', content: 'video/mp4' } },
        { tag: 'meta', attrs: { property: 'og:video:width', content: '1280' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://media.example.org/clips/og.jpg' } },
        {
          tag: 'script',
          attrs: { type: 'application/ld+json' },
          text: JSON.stringify({
            '@context': 'https://schema.org',
            '@graph': [
              { '@type': 'NewsArticle', headline: 'Story' },
              { '@type': 'VideoObject', name: 'LD video', contentUrl: '/media/ld/master.m3u8', thumbnailUrl: ['https://media.example.org/ld.jpg'], duration: 'PT2M3S' },
            ],
          }),
        },
        {
          tag: 'video',
          attrs: { src: 'https://media.example.org/inline.webm', poster: '/poster.jpg' },
          props: { duration: 30, videoWidth: 640, videoHeight: 360 },
          children: [{ tag: 'source', attrs: { src: '/media/alt.mp4', type: 'video/mp4' } }],
        },
        { tag: 'video', attrs: { src: 'blob:https://news.example.org/5f2a' } },
        {
          tag: 'video',
          attrs: { 'data-sources': JSON.stringify([{ src: LINKEDIN_URL, type: 'video/mp4' }]), 'data-poster-url': 'https://media.licdn.com/poster.jpg' },
        },
      ],
    });
    await page.domContentLoaded();
    await page.settle(300);
    const byKey = new Map(page.candidates().map((candidate) => [candidate.key, candidate]));

    const ld = byKey.get('url:https://news.example.org/media/ld/master.m3u8');
    assert.equal(ld?.title, 'LD video');
    assert.equal(ld?.durationSec, 123);
    assert.equal(ld?.thumbnailUrl, 'https://media.example.org/ld.jpg');
    assert.equal(ld?.sources[0].kind, 'hls');

    const og = byKey.get('url:https://media.example.org/clips/og.mp4');
    assert.equal(og?.title, 'OG title');
    assert.equal(og?.provenance, 'dom');
    assert.deepEqual(og?.sources, [{ kind: 'progressive', url: 'https://media.example.org/clips/og.mp4', width: 1280, mimeType: 'video/mp4' }]);

    const inline = byKey.get('url:https://media.example.org/inline.webm');
    assert.equal(inline?.thumbnailUrl, 'https://news.example.org/poster.jpg');
    assert.equal(inline?.durationSec, 30);
    assert.deepEqual(inline?.sources, [{ kind: 'progressive', url: 'https://media.example.org/inline.webm', width: 640, height: 360 }]);
    assert.ok(byKey.has('url:https://news.example.org/media/alt.mp4'));

    assert.equal(byKey.get(`url:${LINKEDIN_URL}`)?.thumbnailUrl, 'https://media.licdn.com/poster.jpg');
    assert.ok([...byKey.keys()].every((key) => !key.includes('blob:')));
    assert.equal(byKey.size, 5);
  });

  test('og:video pointing at an embed page is not media', async () => {
    const page = loadDetector({
      url: 'https://blog.example.org/post',
      elements: [
        { tag: 'meta', attrs: { property: 'og:video', content: 'https://player.example.com/embed/123' } },
        { tag: 'meta', attrs: { property: 'og:video:type', content: 'text/html' } },
      ],
    });
    await page.domContentLoaded();
    await page.settle(300);
    assert.deepEqual(page.candidates(), []);
  });

  test('SPA navigation posts nav once per URL change and rescans page data', async () => {
    const page = loadDetector({ url: 'https://www.example.com/feed', readyState: 'complete', title: 'Feed' });
    await page.settle();
    await page.navigate('/video/1');
    await page.navigate('/video/1', 'replaceState');
    page.addElements([
      { tag: 'script', attrs: { type: 'application/ld+json' }, text: JSON.stringify({ '@type': 'VideoObject', contentUrl: 'https://cdn.example.com/after-nav.mp4' }) },
    ]);
    // The rescan runs 1 s after navigation and its batch flushes within 300 ms.
    await page.settle(1300);
    const navs = page.messages.filter((message) => message.type === 'nav');
    assert.deepEqual(
      navs.map((message) => (message.type === 'nav' ? [message.url, message.title] : [])),
      [['https://www.example.com/video/1', 'Feed']],
    );
    assert.ok(page.candidates().some((candidate) => candidate.key === 'url:https://cdn.example.com/after-nav.mp4'));
  });
});

describe('players', () => {
  test('blob: player hints carry MediaSource codecs; play and pause are sent at once, refreshes at most once per second', async () => {
    const page = loadDetector({ url: 'https://www.example.com/reels', readyState: 'complete', viewport: { width: 400, height: 800 } });
    const MediaSource = page.window.MediaSource as new () => { addSourceBuffer(type: string): unknown };
    const URLClass = page.window.URL as unknown as { createObjectURL(object: unknown): string };
    const mediaSource = new MediaSource();
    const blobUrl = URLClass.createObjectURL(mediaSource);
    mediaSource.addSourceBuffer('video/mp4; codecs="avc1.640028"');
    mediaSource.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');

    const [video] = page.addElements([
      {
        tag: 'video',
        attrs: { poster: 'https://www.example.com/poster.jpg' },
        props: { currentSrc: blobUrl, duration: 61.5, videoWidth: 1080, videoHeight: 1920, paused: false },
        rect: { left: 0, top: 400, width: 400, height: 800 },
      },
    ]);
    await page.mediaEvent(video, 'play');
    const expected: PlayerHint = {
      isBlob: true,
      poster: 'https://www.example.com/poster.jpg',
      durationSec: 61.5,
      width: 1080,
      height: 1920,
      playing: true,
      visibleRatio: 0.5,
      mseCodecs: ['video/mp4; codecs="avc1.640028"', 'audio/mp4; codecs="mp4a.40.2"'],
    };
    assert.deepEqual(page.playerMessages(), [[expected]]);

    for (let step = 0; step < 20; step++) {
      video.rect = { ...video.rect, top: 400 - step * 20 };
      await page.settle(100);
    }
    const refreshes = page.playerMessages().length - 1;
    assert.ok(refreshes >= 1 && refreshes <= 2, `${refreshes} refreshes in 2 s`);

    video.paused = true;
    await page.mediaEvent(video, 'pause');
    assert.equal(page.playerMessages().at(-1)?.[0].playing, false);
  });

  test('a player with a file source reports src and becomes a candidate', async () => {
    const page = loadDetector({ url: 'https://www.example.com/watch', readyState: 'complete' });
    const [video] = page.addElements([
      { tag: 'video', props: { currentSrc: 'https://cdn.example.com/file.mp4', duration: 12 }, rect: { left: 0, top: 0, width: 400, height: 225 } },
    ]);
    await page.mediaEvent(video, 'loadedmetadata');
    await page.settle(1000);
    assert.equal(page.playerMessages().at(-1)?.[0].src, 'https://cdn.example.com/file.mp4');
    assert.deepEqual(
      page.candidates().map((candidate) => candidate.key),
      ['url:https://cdn.example.com/file.mp4'],
    );
  });
});

describe('drm', () => {
  test('probing key systems is not DRM; attaching MediaKeys is, reported once per key system', async () => {
    const page = loadDetector({ url: 'https://stream.example.com/title/1', readyState: 'complete' });
    const navigator = page.window.navigator as { requestMediaKeySystemAccess(keySystem: string, configs: unknown[]): Promise<unknown> };
    await navigator.requestMediaKeySystemAccess('com.widevine.alpha', []);
    await page.settle();
    assert.equal(page.messages.filter((message) => message.type === 'drm').length, 0);

    const media = page.window.HTMLMediaElement as { prototype: { setMediaKeys(keys: unknown): Promise<void> } };
    await media.prototype.setMediaKeys.call({}, { session: true });
    await media.prototype.setMediaKeys.call({}, { session: true });
    await page.settle();
    assert.deepEqual(
      page.messages.flatMap((message) => (message.type === 'drm' ? [message.keySystem] : [])),
      ['com.widevine.alpha'],
    );
  });

  test("an 'encrypted' media event is DRM even when no key system was requested", async () => {
    const page = loadDetector({ url: 'https://stream.example.com/title/2', readyState: 'complete' });
    const [video] = page.addElements([{ tag: 'video' }]);
    await page.mediaEvent(video, 'encrypted');
    assert.deepEqual(
      page.messages.flatMap((message) => (message.type === 'drm' ? [message.keySystem] : [])),
      ['unknown'],
    );
  });
});

describe('policy', () => {
  for (const url of ['https://m.youtube.com/watch?v=abc123', 'https://youtu.be/abc123', 'https://rr3---sn-abc.googlevideo.com/videoplayback?id=1']) {
    test(`${new URL(url).hostname}: hello and policy only, nothing installed`, async () => {
      const page = loadDetector({ url, readyState: 'complete' });
      await page.fetch(`${new URL(url).origin}/youtubei/v1/player`, {
        contentType: 'application/json',
        body: JSON.stringify({ '@type': 'VideoObject', contentUrl: 'https://cdn.example.com/x.mp4' }),
      });
      await page.settle(1000);
      assert.deepEqual(
        page.messages.map((message) => (message.type === 'policy' ? `policy:${message.blocked}` : message.type)),
        ['hello', 'policy:youtube'],
      );
      assert.equal(page.tapStats.clones, 0);
    });
  }

  test('frames that are not http(s) documents are ignored', async () => {
    const page = loadDetector({ url: 'about:blank', readyState: 'complete' });
    await page.settle(1000);
    assert.deepEqual(page.messages, []);
  });
});
