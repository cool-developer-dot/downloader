import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isOpenableInBrowser, resolveDownloadLinkTarget } from './link-actions';

describe('Re-download keeps the app refusals', () => {
  test('a YouTube page is never reopened, but its link can still be copied', () => {
    for (const sourceUrl of ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://m.youtube.com/shorts/x']) {
      assert.deepEqual(resolveDownloadLinkTarget({ engineOwned: true, status: 'COMPLETED', sourceUrl }), {
        pageUrl: null,
        copyUrl: sourceUrl,
      });
    }
  });

  test('private and local addresses are never reopened', () => {
    for (const sourceUrl of ['http://192.168.1.4/v', 'http://localhost:8080/v', 'http://10.0.0.2/x', 'http://[::1]/x']) {
      const target = resolveDownloadLinkTarget({ engineOwned: true, status: 'FAILED', sourceUrl });
      assert.equal(target?.pageUrl, null, sourceUrl);
      assert.ok(target?.copyUrl);
    }
  });

  test('ordinary public pages are reopened', () => {
    assert.equal(isOpenableInBrowser('https://www.instagram.com/reel/abc/'), true);
    assert.equal(isOpenableInBrowser('not a url'), false);
  });
});
