import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { BrowserHistoryEntry } from '@/storage/types';

import { reducePrependVisit } from './visit-reducer';

function entry(id: string, url: string): BrowserHistoryEntry {
  return {
    id,
    url,
    title: url,
    hostname: 'example.com',
    visitedAt: '2026-09-26T10:00:00.000Z',
    createdAt: '2026-09-26T10:00:00.000Z',
  };
}

describe('history visits recorded while browsing', () => {
  test('do not count as a loaded history, so opening History still reads the stored entries', () => {
    const next = reducePrependVisit({ items: [], total: 0 }, entry('a', 'https://example.com/a'));
    assert.equal(next.items.length, 1);
    assert.equal(next.total, 1);
    assert.equal('initialized' in next, false);
    assert.equal('ready' in next, false);
  });

  test('a revisit moves the entry to the top without growing the total', () => {
    let state = { items: [] as BrowserHistoryEntry[], total: 0 };
    state = { ...state, ...reducePrependVisit(state, entry('a', 'https://example.com/a')) };
    state = { ...state, ...reducePrependVisit(state, entry('b', 'https://example.com/b')) };
    state = { ...state, ...reducePrependVisit(state, entry('a2', 'https://example.com/a')) };
    assert.deepEqual(state.items.map((item) => item.id), ['a2', 'b']);
    assert.equal(state.total, 2);
  });
});
