import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { NetworkMediaObservation } from '@modules/vidorax-web/src/VidoraWeb.types';

import {
  applyObservations,
  classifyObservation,
  fileNameFromContentDisposition,
  forgetTab,
  noteTabActivity,
  registerWebViewTag,
  routeObservations,
  tabForViewTag,
  unregisterWebViewTag,
  webDownloadCandidate,
} from './network.ts';
import { startDocument } from './tab-state.ts';

function observation(overrides: Partial<NetworkMediaObservation>): NetworkMediaObservation {
  return {
    viewTag: 11,
    url: 'https://cdn.example.com/v/clip.mp4',
    method: 'GET',
    isMainFrame: false,
    rangeStart: null,
    accept: null,
    referer: 'https://www.example.com/watch/1',
    hint: 'progressive',
    observedAt: 1000,
    ...overrides,
  };
}

afterEach(() => {
  forgetTab('a');
  forgetTab('b');
});

describe('view tag registry', () => {
  test('registers, re-registers and unregisters tabs', () => {
    registerWebViewTag('a', 11);
    assert.equal(tabForViewTag(11), 'a');
    registerWebViewTag('a', 12);
    assert.equal(tabForViewTag(11), null);
    assert.equal(tabForViewTag(12), 'a');
    unregisterWebViewTag('a');
    assert.equal(tabForViewTag(12), null);
  });
});

describe('routeObservations', () => {
  test('routes by view tag and drops unknown tags', () => {
    registerWebViewTag('a', 11);
    registerWebViewTag('b', 22);
    const routed = routeObservations(
      [observation({ viewTag: 11 }), observation({ viewTag: 22 }), observation({ viewTag: 99 })],
      [],
    );
    assert.equal(routed.get('a')?.length, 1);
    assert.equal(routed.get('b')?.length, 1);
    assert.equal(routed.size, 2);
  });

  test('routes service-worker observations to the most recently active tab on the referer origin', () => {
    const tabs = [
      { tabId: 'a', currentUrl: 'https://www.example.com/feed' },
      { tabId: 'b', currentUrl: 'https://www.example.com/other' },
    ];
    noteTabActivity('a', 10);
    noteTabActivity('b', 20);
    const sw = observation({ viewTag: -1, referer: 'https://www.example.com/sw.js' });
    assert.deepEqual([...routeObservations([sw], tabs).keys()], ['b']);
    assert.equal(routeObservations([observation({ viewTag: -1, referer: null })], tabs).size, 0);
    assert.equal(routeObservations([observation({ viewTag: -1, referer: 'https://elsewhere.com/' })], tabs).size, 0);
  });
});

describe('classifyObservation', () => {
  test('manifests and progressive files are media; segments, range requests and byte-range URLs are activity', () => {
    assert.deepEqual(classifyObservation(observation({ hint: 'manifest-hls', url: 'https://c.com/a.m3u8' })), {
      type: 'media',
      source: { kind: 'hls', url: 'https://c.com/a.m3u8' },
      referer: 'https://www.example.com/watch/1',
    });
    assert.equal(classifyObservation(observation({ hint: 'manifest-dash' }))?.type, 'media');
    assert.equal(classifyObservation(observation({ hint: 'segment' }))?.type, 'activity');
    assert.equal(classifyObservation(observation({ hint: 'range-media', rangeStart: 0 }))?.type, 'activity');
    assert.equal(
      classifyObservation(observation({ hint: 'progressive', url: 'https://video.fbcdn.net/v.mp4?bytestart=0&byteend=99' }))?.type,
      'activity',
    );
  });

  test('unknown hints become manifests by extension only', () => {
    const hls = classifyObservation(observation({ hint: 'unknown', url: 'https://c.com/live/index.M3U8?x=1' }));
    assert.equal(hls?.type === 'media' ? hls.source.kind : null, 'hls');
    assert.equal(classifyObservation(observation({ hint: 'unknown', url: 'https://c.com/a.mp4' })), null);
  });

  test('ignores non-GET, non-http and YouTube requests', () => {
    assert.equal(classifyObservation(observation({ method: 'POST' })), null);
    assert.equal(classifyObservation(observation({ url: 'blob:https://c.com/1' })), null);
    assert.equal(classifyObservation(observation({ url: 'https://rr1.googlevideo.com/videoplayback' })), null);
  });
});

describe('applyObservations', () => {
  test('creates url: items with network provenance and the observed referer, and marks activity', () => {
    const page = 'https://www.example.com/watch/1';
    let tab = startDocument(undefined, page);
    tab = applyObservations(
      tab,
      [
        observation({ hint: 'manifest-hls', url: 'https://cdn.example.com/vod/9/master.m3u8?token=abc', referer: 'https://player.example.net/embed/9' }),
        observation({ hint: 'segment', url: 'https://cdn.example.com/vod/9/720/seg-1.ts', observedAt: 5000 }),
      ],
      2000,
    );
    assert.deepEqual(tab.order, ['url:https://cdn.example.com/vod/9/master.m3u8']);
    const item = tab.items[tab.order[0]];
    assert.equal(item.frameUrl, 'https://player.example.net/embed/9');
    assert.equal(item.site, 'web');
    assert.equal(item.activeAt, 5000);
    assert.equal(item.availability.status, 'unresolved');
  });

  test('falls back to the tab URL when there is no referer and uses the page site', () => {
    const page = 'https://www.instagram.com/reel/C9xYz/';
    const tab = applyObservations(startDocument(undefined, page), [observation({ referer: null })], 1);
    const item = tab.items[tab.order[0]];
    assert.equal(item.frameUrl, page);
    assert.equal(item.site, 'instagram');
  });
});

describe('web downloads', () => {
  test('builds a progressive candidate with MIME type, size and a title from Content-Disposition', () => {
    const candidate = webDownloadCandidate(
      {
        viewTag: 11,
        url: 'https://files.example.com/dl?id=5',
        userAgent: 'UA',
        contentDisposition: 'attachment; filename="My_holiday clip.mp4"',
        mimeType: 'video/mp4; charset=binary',
        contentLength: 1234,
      },
      'https://www.example.com/page',
    );
    assert.deepEqual(candidate, {
      key: 'url:https://files.example.com/dl?id=5',
      site: 'web',
      title: 'My holiday clip',
      provenance: 'web-download',
      sources: [{ kind: 'progressive', url: 'https://files.example.com/dl?id=5', mimeType: 'video/mp4', sizeBytes: 1234 }],
    });
  });

  test('maps manifest MIME types and falls back to the URL file name', () => {
    const candidate = webDownloadCandidate(
      { viewTag: 1, url: 'https://c.com/show/Episode%201.m3u8', userAgent: 'UA', contentDisposition: null, mimeType: 'application/vnd.apple.mpegurl', contentLength: null },
      '',
    );
    assert.equal(candidate?.sources[0].kind, 'hls');
    assert.equal(candidate?.title, 'Episode 1');
  });

  test('rejects YouTube and non-http URLs', () => {
    const event = { viewTag: 1, userAgent: 'UA', contentDisposition: null, mimeType: null, contentLength: null };
    assert.equal(webDownloadCandidate({ ...event, url: 'https://youtu.be/x' }, ''), null);
    assert.equal(webDownloadCandidate({ ...event, url: 'data:video/mp4;base64,AA' }, ''), null);
  });

  test('parses RFC 5987 and plain filename parameters', () => {
    assert.equal(fileNameFromContentDisposition("attachment; filename*=UTF-8''%D9%88%DB%8C%DA%88%DB%8C%D9%88.mp4"), 'ویڈیو.mp4');
    assert.equal(fileNameFromContentDisposition('inline; filename=clip.webm'), 'clip.webm');
    assert.equal(fileNameFromContentDisposition('attachment'), null);
    assert.equal(fileNameFromContentDisposition(null), null);
  });
});
