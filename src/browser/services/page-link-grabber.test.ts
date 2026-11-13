import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseBrowserChromeMessage } from '@/browser/bridge/browser-chrome.bridge';
import { batchAddPrefill } from '@/screens/batch-add/batch-add-prefill';

import { MAX_BATCH_LINKS } from './link-intake';
import {
  buildPageLinkGrabberScript,
  grabPageLinks,
  PAGE_LINKS_MAX_RAW,
  receivePageLinks,
  selectGrabbedLinks,
} from './page-link-grabber';

type FakeNode = { href?: string; src?: string; currentSrc?: string };

/** Runs the page script against a minimal document; returns what it posted (the raw bridge string). */
function runInPage(script: string, page: { url: string; media?: FakeNode[]; anchors?: FakeNode[] }): string[] {
  const posted: string[] = [];
  const document = {
    querySelectorAll: (selector: string) => (selector.startsWith('video') ? page.media ?? [] : page.anchors ?? []),
  };
  const window = { ReactNativeWebView: { postMessage: (data: string) => posted.push(data) } };
  new Function('window', 'document', 'location', script)(window, document, { href: page.url });
  return posted;
}

describe('selectGrabbedLinks', () => {
  test('keeps video files and streams, in page order, one per file', () => {
    assert.deepEqual(
      selectGrabbedLinks(
        [
          'https://cdn.example.com/a.mp4',
          'https://example.com/about',
          '/media/b.webm#t=3',
          'https://cdn.example.com/live/master.m3u8',
          'https://cdn.example.com/a.mp4',
          'https://cdn.example.com/c.mpd',
          'https://example.com/cover.jpg',
          'https://example.com/song.mp3',
        ],
        'https://example.com/videos/',
      ),
      [
        'https://cdn.example.com/a.mp4',
        'https://example.com/media/b.webm',
        'https://cdn.example.com/live/master.m3u8',
        'https://cdn.example.com/c.mpd',
      ],
    );
  });

  test('applies the app rules: no YouTube, no private or local hosts, no other schemes', () => {
    assert.deepEqual(
      selectGrabbedLinks(
        [
          'https://www.youtube.com/watch.mp4',
          'http://192.168.1.4/v.mp4',
          'http://localhost/v.mp4',
          'blob:https://example.com/x',
          'data:video/mp4;base64,AAAA',
          'ftp://example.com/v.mp4',
          42,
          null,
          'https://ok.example.com/v.mov',
        ],
        'https://example.com/',
      ),
      ['https://ok.example.com/v.mov'],
    );
  });

  test('a MIME hint in the query counts; a signed copy of the same file does not repeat it', () => {
    assert.deepEqual(
      selectGrabbedLinks(
        [
          'https://cdn.example.com/stream?mime_type=video_mp4&id=1',
          'https://cdn.example.com/v/clip.mp4?token=abc',
          'https://cdn.example.com/v/clip.mp4?token=def',
        ],
        'https://example.com/',
      ).length,
      2,
    );
  });

  test('stops at the Batch Add limit', () => {
    const many = Array.from({ length: 120 }, (_, i) => `https://cdn.example.com/${i}.mp4`);
    assert.equal(selectGrabbedLinks(many, 'https://example.com/').length, MAX_BATCH_LINKS);
  });
});

describe('page script', () => {
  test('reports media sources and file links on the browser-chrome channel, and the bridge reads it', () => {
    const posted = runInPage(buildPageLinkGrabberScript('grab-1'), {
      url: 'https://example.com/list',
      media: [{ currentSrc: 'https://cdn.example.com/playing', src: 'https://cdn.example.com/playing' }, { src: 'blob:x' }],
      anchors: [
        { href: 'https://example.com/next-page' },
        { href: 'https://cdn.example.com/a.mp4?sig=1#t=2' },
        { href: 'https://cdn.example.com/b.M3U8' },
        { href: 'javascript:void(0)' },
        { href: 'https://cdn.example.com/x?format=hls' },
      ],
    });
    assert.equal(posted.length, 1);
    const message = parseBrowserChromeMessage(posted[0]);
    assert.deepEqual(message, {
      type: 'page_links',
      payload: {
        requestId: 'grab-1',
        pageUrl: 'https://example.com/list',
        links: [
          // A playing element's source is always reported (the bytes decide); plain links only look like files.
          'https://cdn.example.com/playing',
          'https://cdn.example.com/a.mp4?sig=1#t=2',
          'https://cdn.example.com/b.M3U8',
          'https://cdn.example.com/x?format=hls',
        ],
      },
    });
  });

  test('caps what a large page sends so the bridge always accepts the message', () => {
    const anchors = Array.from({ length: 2000 }, (_, i) => ({ href: `https://cdn.example.com/${'d'.repeat(180)}/${i}.mp4` }));
    const posted = runInPage(buildPageLinkGrabberScript('grab-2'), { url: 'https://example.com/', anchors });
    assert.ok(posted[0]!.length < 50_000);
    const message = parseBrowserChromeMessage(posted[0]);
    assert.equal(message?.type, 'page_links');
    if (message?.type === 'page_links') {
      assert.ok(message.payload.links.length > 100 && message.payload.links.length <= PAGE_LINKS_MAX_RAW);
    }
  });

  test('the bridge refuses a page_links message without its request id or links', () => {
    const raw = (payload: unknown) => JSON.stringify({ channel: 'vidorax-browser-chrome', type: 'page_links', payload });
    assert.equal(parseBrowserChromeMessage(raw({ pageUrl: 'https://a.com/', links: [] })), null);
    assert.equal(parseBrowserChromeMessage(raw({ requestId: 'x', pageUrl: 'https://a.com/', links: 'a' })), null);
    assert.deepEqual(parseBrowserChromeMessage(raw({ requestId: 'x', pageUrl: 'https://a.com/', links: [1, ' ', 'https://a.com/v.mp4'] })), {
      type: 'page_links',
      payload: { requestId: 'x', pageUrl: 'https://a.com/', links: ['https://a.com/v.mp4'] },
    });
  });
});

describe('grabPageLinks', () => {
  test('resolves with the selected links of the answer to its own request', async () => {
    let script = '';
    const grab = grabPageLinks({ injectJavaScript: (s) => (script = s) }, 1_000);
    const requestId = /requestId: "([^"]+)"/.exec(script)?.[1];
    assert.ok(requestId);
    assert.equal(receivePageLinks('someone-else', 'https://a.com/', ['https://a.com/v.mp4']), false);
    assert.equal(receivePageLinks(requestId!, 'https://a.com/', ['https://a.com/v.mp4', 'https://a.com/page']), true);
    assert.deepEqual(await grab, ['https://a.com/v.mp4']);
    // Answered once: a late duplicate finds nobody waiting.
    assert.equal(receivePageLinks(requestId!, 'https://a.com/', []), false);
  });

  test('null without a page, when injecting fails, or when the page never answers', async () => {
    assert.equal(await grabPageLinks(null), null);
    assert.equal(
      await grabPageLinks({
        injectJavaScript: () => {
          throw new Error('gone');
        },
      }),
      null,
    );
    assert.equal(await grabPageLinks({ injectJavaScript: () => undefined }, 10), null);
  });
});

describe('batchAddPrefill', () => {
  test('is taken once; blank text is never kept', () => {
    batchAddPrefill.set('https://a.com/1.mp4\nhttps://a.com/2.mp4');
    assert.equal(batchAddPrefill.take(), 'https://a.com/1.mp4\nhttps://a.com/2.mp4');
    assert.equal(batchAddPrefill.take(), null);
    batchAddPrefill.set('   ');
    assert.equal(batchAddPrefill.take(), null);
  });
});
