import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { stillClearableIds } from './download-history';

describe('Clear History re-checks each row (audit)', () => {
  test('a row retried or resumed since the dialog opened is never removed', () => {
    const now: Record<string, string> = { a: 'COMPLETED', b: 'QUEUED', c: 'DOWNLOADING', d: 'FAILED', e: 'PAUSED' };
    assert.deepEqual(stillClearableIds(['a', 'b', 'c', 'd', 'e', 'gone'], (id) => now[id] as never), ['a', 'd']);
  });
});
