import assert from 'node:assert/strict';
import { test } from 'node:test';

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
