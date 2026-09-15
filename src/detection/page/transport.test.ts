import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { loadDetector } from './test-harness.ts';

const PAGE = 'https://www.instagram.com/reels/';
const API = 'https://www.instagram.com/graphql/query';

function reelsBody(count: number, options: { suffix?: string; manifestPadding?: number; title?: string } = {}): string {
  const items = Array.from({ length: count }, (_, i) => ({
    code: `Code${i}${options.suffix ?? ''}`,
    caption: options.title ? { text: options.title } : undefined,
    video_versions: [{ width: 720, height: 1280, url: `https://scontent.cdninstagram.com/v/reel${i}${options.suffix ?? ''}.mp4` }],
    video_dash_manifest: options.manifestPadding ? `<MPD>${'x'.repeat(options.manifestPadding)}</MPD>` : undefined,
  }));
  return JSON.stringify({ data: { items } });
}

describe('transport', () => {
  test('posts hello once with the frame, even when the script is injected again', async () => {
    const page = loadDetector({ url: PAGE });
    page.inject();
    await page.settle(1000);
    const hellos = page.messages.filter((message) => message.type === 'hello');
    assert.equal(hellos.length, 1);
    assert.deepEqual(hellos[0], {
      ch: 'vdx',
      v: 1,
      type: 'hello',
      frame: { url: PAGE, isMain: true, userAgent: String((page.window.navigator as { userAgent: string }).userAgent) },
    });
  });

  test('a child frame whose window.top is inaccessible reports isMain false', async () => {
    const page = loadDetector({ url: 'https://player.example.net/embed/1', isMain: false });
    await page.settle();
    assert.equal(page.messages[0]?.frame.isMain, false);
  });

  test('messages wait for the bridge and are delivered in order once it exists', async () => {
    const page = loadDetector({ url: PAGE, bridge: false, readyState: 'complete' });
    await page.fetch(API, { contentType: 'application/json', body: reelsBody(1) });
    await page.settle(300);
    assert.equal(page.raw.length, 0);

    page.attachBridge();
    await page.settle(300);
    assert.deepEqual(
      page.messages.map((message) => message.type),
      ['hello', 'candidates'],
    );
  });

  test('batches at most 20 candidates per message and flushes the rest within 300 ms', async () => {
    const page = loadDetector({ url: PAGE, readyState: 'complete' });
    await page.fetch(API, { contentType: 'application/json', body: reelsBody(45) });
    assert.equal(page.candidates().length, 40, 'full batches go out immediately');

    await page.settle(300);
    const batches = page.messages.filter((message) => message.type === 'candidates');
    assert.deepEqual(
      batches.map((message) => (message.type === 'candidates' ? message.candidates.length : 0)),
      [20, 20, 5],
    );
  });

  test('keeps every message under 200 KB, counting UTF-8 bytes', async () => {
    const page = loadDetector({ url: PAGE, readyState: 'complete' });
    const urduTitle = 'اردو '.repeat(60);
    await page.fetch(API, { contentType: 'application/json', body: reelsBody(6, { manifestPadding: 60_000, title: urduTitle }) });
    await page.settle(300);
    assert.equal(page.candidates().length, 6);
    assert.ok(page.raw.length >= 3);
    for (const message of page.raw) assert.ok(Buffer.byteLength(message, 'utf8') <= 200_000, `message of ${Buffer.byteLength(message)} bytes`);
  });

  test('an unchanged candidate is posted once; a changed one is posted again', async () => {
    const page = loadDetector({ url: PAGE, readyState: 'complete' });
    await page.fetch(API, { contentType: 'application/json', body: reelsBody(1) });
    await page.fetch(API, { contentType: 'application/json', body: reelsBody(1) });
    await page.settle(300);
    assert.equal(page.candidates().length, 1);

    const refreshed = JSON.parse(reelsBody(1)) as { data: { items: { video_versions: { url: string }[] }[] } };
    refreshed.data.items[0].video_versions[0].url += '?oe=refreshed';
    await page.fetch(API, { contentType: 'application/json', body: JSON.stringify(refreshed) });
    await page.settle(300);
    assert.equal(page.candidates().length, 2);
    assert.equal(page.candidates()[1].key, 'instagram:Code0');
  });

  test('a throwing bridge never surfaces in the page', async () => {
    const page = loadDetector({
      url: PAGE,
      readyState: 'complete',
      postMessage: () => {
        throw new Error('bridge gone');
      },
    });
    const response = await page.fetch(API, { contentType: 'application/json', body: reelsBody(3) });
    await page.settle(300);
    assert.equal(await response.text(), reelsBody(3));
  });
});
