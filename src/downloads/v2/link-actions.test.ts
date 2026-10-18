import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadStatus } from '@/api/types';

import { LINK_ACTION_STATUSES, resolveDownloadLinkTarget, toWebPageUrl } from './link-actions';

const PAGE = 'https://www.example.com/videos/123?ref=home';

describe('toWebPageUrl', () => {
  test('accepts http and https pages', () => {
    assert.equal(toWebPageUrl(PAGE), PAGE);
    assert.equal(toWebPageUrl('http://example.com/a'), 'http://example.com/a');
  });

  test('trims surrounding whitespace', () => {
    assert.equal(toWebPageUrl(`  ${PAGE}\n`), PAGE);
  });

  test('refuses empty, relative and non-web values', () => {
    for (const value of [null, undefined, '', '   ', '/videos/1', 'example.com/x', 'file:///data/x.mp4',
      'content://media/1', 'blob:https://example.com/abc', 'javascript:alert(1)', 'about:blank', 'data:text/plain,x']) {
      assert.equal(toWebPageUrl(value), null, String(value));
    }
  });
});

describe('resolveDownloadLinkTarget', () => {
  test('finished, failed and cancelled v2 rows with a page get both actions', () => {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED'] as const) {
      assert.deepEqual(resolveDownloadLinkTarget({ engineOwned: true, status, sourceUrl: PAGE }), {
        pageUrl: PAGE,
        copyUrl: PAGE,
      });
    }
  });

  test('active rows get neither action', () => {
    for (const status of ['QUEUED', 'DOWNLOADING', 'PAUSED'] as DownloadStatus[]) {
      assert.equal(resolveDownloadLinkTarget({ engineOwned: true, status, sourceUrl: PAGE }), null, status);
    }
  });

  test('a row without a usable page gets neither action', () => {
    for (const sourceUrl of ['', null, undefined, 'not a url', 'file:///x.mp4']) {
      assert.equal(resolveDownloadLinkTarget({ engineOwned: true, status: 'COMPLETED', sourceUrl }), null);
    }
  });

  test('v1 rows are never changed', () => {
    assert.equal(resolveDownloadLinkTarget({ engineOwned: false, status: 'COMPLETED', sourceUrl: PAGE }), null);
  });

  test('the status list is exactly the three terminal statuses', () => {
    assert.deepEqual([...LINK_ACTION_STATUSES].sort(), ['CANCELLED', 'COMPLETED', 'FAILED']);
  });
});
