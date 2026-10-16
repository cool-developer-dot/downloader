import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadItem } from '@/api/types';

import {
  MAX_QUEUE_ITEMS,
  pageKey,
  parseQueueBackup,
  planQueueImport,
  QUEUE_FORMAT,
  QUEUE_VERSION,
  queueBackupItems,
  queueToJson,
} from './queue-backup';

function row(partial: Partial<DownloadItem> & Pick<DownloadItem, 'id' | 'status'>): DownloadItem {
  return {
    userId: '', title: 'Clip', sourceUrl: 'https://www.example.com/v/1', platform: 'OTHER', thumbnailUrl: '', fileName: '',
    folderId: null, fileSize: '0', progress: 0, quality: '720p', resolution: null, bitrate: null, mimeType: null,
    container: null, retryCount: 0, workerState: null, errorCode: null, errorMessage: null, downloadedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...partial,
  };
}

describe('export', () => {
  test('queued, running, paused and failed rows with a page; nothing else', () => {
    const { items, withoutPage } = queueBackupItems([
      row({ id: 'q', status: 'QUEUED', sourceUrl: 'https://a.com/1?token=secret&v=2' }),
      row({ id: 'p', status: 'PAUSED', sourceUrl: 'https://a.com/2' }),
      row({ id: 'f', status: 'FAILED', sourceUrl: 'https://a.com/3', quality: null }),
      row({ id: 'd', status: 'DOWNLOADING' }),
      row({ id: 'c', status: 'COMPLETED' }),
      row({ id: 'x', status: 'CANCELLED' }),
      row({ id: 'n', status: 'QUEUED', sourceUrl: '' }),
    ]);
    assert.deepEqual(items, [
      { pageUrl: 'https://a.com/1?v=2', title: 'Clip', quality: '720p', status: 'queued' },
      { pageUrl: 'https://a.com/2', title: 'Clip', quality: '720p', status: 'paused' },
      { pageUrl: 'https://a.com/3', title: 'Clip', quality: null, status: 'failed' },
      { pageUrl: 'https://www.example.com/v/1', title: 'Clip', quality: '720p', status: 'queued' },
    ]);
    assert.equal(withoutPage, 1);
  });

  test('the file is versioned and carries no token', () => {
    const json = queueToJson(queueBackupItems([row({ id: 'q', status: 'QUEUED', sourceUrl: 'https://a.com/1?sig=s' })]).items, new Date(0));
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, QUEUE_FORMAT);
    assert.equal(parsed.version, QUEUE_VERSION);
    assert.ok(!json.includes('sig='));
  });

  test('a running download is written as a pending item with the same fields and no media URL', () => {
    const running = row({
      id: 'd',
      status: 'DOWNLOADING',
      sourceUrl: 'https://a.com/live?v=9&signature=abc',
      progress: 42,
      fileName: 'Clip_ab12.mp4',
      thumbnailUrl: 'https://cdn.a.com/t.jpg?token=t',
    });
    const { items } = queueBackupItems([running]);
    assert.deepEqual(items, [{ pageUrl: 'https://a.com/live?v=9', title: 'Clip', quality: '720p', status: 'queued' }]);
    const json = queueToJson(items, new Date(0));
    for (const leaked of ['cdn.a.com', 'signature', 'token', 'Clip_ab12', '42']) {
      assert.ok(!json.includes(leaked), leaked);
    }
  });

  test('a running download is imported like any other item', () => {
    const json = queueToJson(queueBackupItems([row({ id: 'd', status: 'DOWNLOADING', sourceUrl: 'https://a.com/live' })]).items, new Date(0));
    const parsed = parseQueueBackup(json);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.deepEqual(planQueueImport(parsed.items, []).added, [
        { key: 'a.com/live', pageUrl: 'https://a.com/live', title: 'Clip', quality: '720p' },
      ]);
      assert.equal(planQueueImport(parsed.items, ['https://a.com/live']).duplicates, 1);
    }
  });

  test('round trip: what export writes, import reads', () => {
    const json = queueToJson(queueBackupItems([row({ id: 'q', status: 'QUEUED' })]).items, new Date(0));
    const parsed = parseQueueBackup(json);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(planQueueImport(parsed.items, []).added.length, 1);
    }
  });
});

describe('parseQueueBackup', () => {
  test('refuses what is not a queue backup of a known version', () => {
    assert.deepEqual(parseQueueBackup('{nope'), { ok: false, reason: 'not-json' });
    assert.deepEqual(parseQueueBackup('[]'), { ok: false, reason: 'wrong-format' });
    assert.deepEqual(parseQueueBackup(JSON.stringify({ format: 'other', version: 1, items: [] })), { ok: false, reason: 'wrong-format' });
    assert.deepEqual(parseQueueBackup(JSON.stringify({ format: QUEUE_FORMAT, version: 99, items: [] })), {
      ok: false,
      reason: 'unsupported-version',
    });
    assert.deepEqual(parseQueueBackup(JSON.stringify({ format: QUEUE_FORMAT, version: '1', items: [] })), {
      ok: false,
      reason: 'unsupported-version',
    });
    assert.deepEqual(
      parseQueueBackup(JSON.stringify({ format: QUEUE_FORMAT, version: 1, items: new Array(MAX_QUEUE_ITEMS + 1).fill({}) })),
      { ok: false, reason: 'too-many' },
    );
  });

  test('accepts a BOM', () => {
    assert.equal(parseQueueBackup(`\uFEFF${JSON.stringify({ format: QUEUE_FORMAT, version: 1, items: [] })}`).ok, true);
  });
});

describe('planQueueImport', () => {
  test('sorts every item into added, duplicate, refused or invalid', () => {
    const plan = planQueueImport(
      [
        { pageUrl: 'https://new.com/v/1', title: 'New', quality: '1080p' },
        { pageUrl: 'https://www.example.com/v/1/', title: 'Already downloading' },
        { pageUrl: 'https://new.com/v/1', title: 'Same page twice' },
        { pageUrl: 'https://www.youtube.com/watch?v=abc' },
        { pageUrl: 'https://youtu.be/abc' },
        { pageUrl: 'http://192.168.1.10/video' },
        { pageUrl: 'http://localhost:8080/a' },
        { pageUrl: 'http://metadata.google.internal/x' },
        { pageUrl: 'file:///sdcard/x.mp4' },
        { pageUrl: 'javascript:alert(1)' },
        { pageUrl: '' },
        { pageUrl: 42 },
        'a string',
        null,
        { title: 'no page' },
        { pageUrl: 'not a url' },
      ],
      ['https://example.com/v/1'],
    );
    assert.deepEqual(plan.added, [{ key: 'new.com/v/1', pageUrl: 'https://new.com/v/1', title: 'New', quality: '1080p' }]);
    assert.equal(plan.duplicates, 2);
    assert.equal(plan.refused, 7);
    assert.equal(plan.invalid, 6);
  });

  test('added items carry no token and bounded text', () => {
    const plan = planQueueImport([{ pageUrl: 'https://a.com/p?id=1&access_token=t', title: 'x'.repeat(500), quality: 7 }], []);
    assert.equal(plan.added[0]?.pageUrl, 'https://a.com/p?id=1');
    assert.equal(plan.added[0]?.title.length, 200);
    assert.equal(plan.added[0]?.quality, null);
  });

  test('pageKey ignores www, case of the host and a trailing slash', () => {
    assert.equal(pageKey('https://WWW.Example.com/a/'), pageKey('http://example.com/a'));
    assert.notEqual(pageKey('https://example.com/a?v=1'), pageKey('https://example.com/a?v=2'));
    assert.equal(pageKey('nope'), null);
  });
});
