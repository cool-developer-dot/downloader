import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';

import { parseBrowserChromeMessage } from './browser-chrome.bridge';
import { BROWSER_CHROME_CHANNEL } from './browser-chrome.channel';

const message = (type: string, payload: unknown) => JSON.stringify({ channel: BROWSER_CHROME_CHANNEL, type, payload });

test('a fullscreen report with the video size parses', () => {
  assert.deepEqual(parseBrowserChromeMessage(message('fullscreen', { active: true, width: 1280, height: 720 })), {
    type: 'fullscreen',
    payload: { active: true, width: 1280, height: 720 },
  });
});

test('a fullscreen report without a usable size keeps active and drops the size', () => {
  for (const payload of [
    { active: true },
    { active: true, width: 1280 },
    { active: true, width: 0, height: 720 },
    { active: true, width: -1, height: 720 },
    { active: true, width: '1280', height: '720' },
  ]) {
    assert.deepEqual(parseBrowserChromeMessage(message('fullscreen', payload)), {
      type: 'fullscreen',
      payload: { active: true, width: null, height: null },
    });
  }
  assert.deepEqual(parseBrowserChromeMessage(message('fullscreen', { active: false, width: 1280, height: 720 })), {
    type: 'fullscreen',
    payload: { active: false, width: null, height: null },
  });
});

test('a fullscreen report without a boolean active is ignored', () => {
  assert.equal(parseBrowserChromeMessage(message('fullscreen', { active: 'true', width: 1, height: 1 })), null);
  assert.equal(parseBrowserChromeMessage(message('fullscreen', {})), null);
  assert.equal(parseBrowserChromeMessage(JSON.stringify({ channel: 'other', type: 'fullscreen', payload: { active: true } })), null);
});

describe('B6 page messages', () => {
  const envelope = (type: string, payload: unknown) =>
    JSON.stringify({ channel: 'vidorax-browser-chrome', type, payload });

  it('scroll reports carry the page and window heights (0 when missing or bad)', () => {
    assert.deepEqual(parseBrowserChromeMessage(envelope('scroll', { scrollY: 10.4, height: 5000, viewHeight: 800 })), {
      type: 'scroll',
      payload: { scrollY: 10, pageUrl: '', height: 5000, viewHeight: 800 },
    });
    const old = parseBrowserChromeMessage(envelope('scroll', { scrollY: 3, height: 'x', viewHeight: -1 }));
    assert.deepEqual(old?.type === 'scroll' && [old.payload.height, old.payload.viewHeight], [0, 0]);
  });

  it('auto_scroll: only bottom and touched', () => {
    assert.deepEqual(parseBrowserChromeMessage(envelope('auto_scroll', { event: 'bottom' })), {
      type: 'auto_scroll',
      payload: { event: 'bottom' },
    });
    assert.equal(parseBrowserChromeMessage(envelope('auto_scroll', { event: 'start' })), null);
  });

  it('media_state: a boolean only', () => {
    assert.deepEqual(parseBrowserChromeMessage(envelope('media_state', { playing: true })), {
      type: 'media_state',
      payload: { playing: true },
    });
    assert.equal(parseBrowserChromeMessage(envelope('media_state', { playing: 'yes' })), null);
  });
});
