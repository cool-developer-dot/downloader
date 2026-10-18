import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseQueueBackup, planQueueImport, QUEUE_FORMAT } from './queue-backup';

describe('queue backup (audit)', () => {
  test('a library item or download from the same page is a duplicate, whatever its state', () => {
    const plan = planQueueImport(
      [{ pageUrl: 'https://example.com/v/1' }, { pageUrl: 'https://example.com/v/2' }],
      ['https://www.example.com/v/1/', null, undefined, ''],
    );
    assert.equal(plan.duplicates, 1);
    assert.equal(plan.added.length, 1);
  });

  test('an item with a non-string title or quality is still added, with those fields dropped', () => {
    const plan = planQueueImport([{ pageUrl: 'https://a.com/x', title: { evil: true }, quality: ['720p'] }], []);
    assert.deepEqual(plan.added, [{ key: 'a.com/x', pageUrl: 'https://a.com/x', title: '', quality: null }]);
  });

  test('a file whose items field is not an array is not a backup', () => {
    assert.deepEqual(parseQueueBackup(JSON.stringify({ format: QUEUE_FORMAT, version: 1, items: {} })), {
      ok: false,
      reason: 'wrong-format',
    });
  });
});
