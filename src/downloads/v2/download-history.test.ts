import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadItem } from '@/api/types';

import {
  clearableHistoryIds,
  csvCell,
  errorLogToText,
  HISTORY_FORMAT,
  HISTORY_VERSION,
  historyToCsv,
  historyToJson,
  redactUrls,
  sanitizePageUrl,
  toErrorLog,
  toHistoryRecords,
} from './download-history';

function item(partial: Partial<DownloadItem> & Pick<DownloadItem, 'id' | 'status'>): DownloadItem {
  return {
    userId: '',
    title: 'Clip',
    sourceUrl: 'https://www.example.com/v/1',
    platform: 'OTHER',
    thumbnailUrl: '',
    fileName: '',
    folderId: null,
    fileSize: '0',
    progress: 0,
    quality: null,
    resolution: null,
    bitrate: null,
    mimeType: null,
    container: null,
    retryCount: 0,
    workerState: null,
    errorCode: null,
    errorMessage: null,
    downloadedAt: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:05:00.000Z',
    ...partial,
  };
}

describe('sanitizePageUrl', () => {
  test('keeps the page and its harmless parameters', () => {
    assert.equal(sanitizePageUrl('https://www.facebook.com/watch/?v=123'), 'https://www.facebook.com/watch/?v=123');
  });

  test('drops credentials, signature-like parameters and the fragment', () => {
    assert.equal(
      sanitizePageUrl('https://user:pw@example.com/p?id=7&token=abc&X-Amz-Signature=s&_nc_ohc=x&oe=1#frag'),
      'https://example.com/p?id=7',
    );
  });

  test('refuses anything that is not a web page', () => {
    for (const url of ['', null, 'file:///x', 'blob:https://a/b', 'javascript:x', 'nope']) {
      assert.equal(sanitizePageUrl(url), null);
    }
  });
});

describe('redactUrls', () => {
  test('every URL becomes its host', () => {
    assert.equal(
      redactUrls('GET https://cdn.example.com/v.mp4?token=secret failed; see http://www.site.org/a#b'),
      'GET [cdn.example.com] failed; see [site.org]',
    );
    assert.equal(redactUrls('blob:https://x.com/123 here'), '[blob] here');
    assert.equal(redactUrls('no urls'), 'no urls');
  });
});

describe('history export', () => {
  const rows = [
    item({ id: 'a', status: 'COMPLETED', downloadedAt: '2026-10-02T00:00:00.000Z', fileSize: '1000', quality: '720p', createdAt: '2026-10-02T00:00:00.000Z' }),
    item({ id: 'b', status: 'FAILED', errorCode: 'HTTP_403', errorMessage: 'The site refused this download.', sourceUrl: 'https://cdn.example.com/x?token=t' }),
    item({ id: 'c', status: 'CANCELLED', title: 'میری ویڈیو', createdAt: '2026-09-01T00:00:00.000Z' }),
    item({ id: 'd', status: 'DOWNLOADING', sourceUrl: '' }),
  ];

  test('records are newest first, with no token in any URL', () => {
    const records = toHistoryRecords(rows);
    assert.deepEqual(records.map((r) => r.id), ['a', 'b', 'd', 'c']);
    assert.equal(records[0]?.status, 'completed');
    assert.equal(records[0]?.sizeBytes, 1000);
    assert.equal(records[1]?.pageUrl, 'https://cdn.example.com/x');
    assert.equal(records[1]?.errorCode, 'HTTP_403');
    assert.equal(records[2]?.pageUrl, null);
    assert.ok(!JSON.stringify(records).includes('token'));
  });

  test('JSON is versioned', () => {
    const parsed = JSON.parse(historyToJson(toHistoryRecords(rows), new Date('2026-10-15T00:00:00Z')));
    assert.equal(parsed.format, HISTORY_FORMAT);
    assert.equal(parsed.version, HISTORY_VERSION);
    assert.equal(parsed.exportedAt, '2026-10-15T00:00:00.000Z');
    assert.equal(parsed.items.length, 4);
  });

  test('CSV has a header, quotes where needed and keeps Urdu', () => {
    const csv = historyToCsv(toHistoryRecords(rows));
    assert.ok(csv.startsWith('\uFEFFid,title,site,status'));
    assert.ok(csv.includes('میری ویڈیو'));
    assert.equal(csv.split('\r\n').length, 6); // header + 4 rows + trailing empty
  });

  test('CSV cells are quoted and never formulas', () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(42), '42');
  });
});

describe('error log', () => {
  test('lists only failed downloads, newest first, with a reason', () => {
    const entries = toErrorLog(
      [
        item({ id: 'a', status: 'FAILED', errorMessage: 'Network error.', updatedAt: '2026-10-01T00:00:00.000Z' }),
        item({ id: 'b', status: 'FAILED', errorMessage: null, updatedAt: '2026-10-03T00:00:00.000Z' }),
        item({ id: 'c', status: 'COMPLETED' }),
      ],
      'The download failed.',
    );
    assert.deepEqual(entries.map((e) => [e.id, e.reason]), [
      ['b', 'The download failed.'],
      ['a', 'Network error.'],
    ]);
    assert.equal(entries[0]?.site, 'example.com');
  });

  test('the shared text carries no URL', () => {
    const text = errorLogToText(
      [{ id: 'a', at: '2026-10-01T00:00:00.000Z', site: 'example.com', title: 'see https://x.com/p?token=1', reason: 'r' }],
      'Errors',
    );
    assert.ok(text.startsWith('Errors\n'));
    assert.ok(!text.includes('token'));
    assert.ok(text.includes('[x.com]'));
  });
});

describe('clearableHistoryIds', () => {
  test('finished, failed and cancelled only', () => {
    assert.deepEqual(
      clearableHistoryIds([
        { id: 'a', status: 'COMPLETED' },
        { id: 'b', status: 'FAILED' },
        { id: 'c', status: 'CANCELLED' },
        { id: 'd', status: 'DOWNLOADING' },
        { id: 'e', status: 'PAUSED' },
        { id: 'f', status: 'QUEUED' },
      ]),
      ['a', 'b', 'c'],
    );
  });
});
