import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { duplicatesToDelete, initialDuplicateSelection, keptCopy, toggleDuplicate, type DuplicateGroup } from './duplicates-view';

/** A mock of F14's `findDuplicates()` answer: two groups of identical files. */
const GROUPS: DuplicateGroup[] = [
  {
    hash: 'aaa',
    items: [
      { id: 'clip-1', downloadedAt: '2026-11-01T10:00:00.000Z' },
      { id: 'clip-2', downloadedAt: '2026-11-20T10:00:00.000Z' },
      { id: 'clip-3', downloadedAt: '2026-11-10T10:00:00.000Z' },
    ],
  },
  {
    hash: 'bbb',
    items: [
      { id: 'song-1', downloadedAt: null },
      { id: 'song-2', downloadedAt: '2026-10-01T10:00:00.000Z' },
    ],
  },
];

describe('Files F9 · design 59: Duplicates', () => {
  test('keep newest: every group keeps its newest copy and selects the others', () => {
    assert.equal(keptCopy(GROUPS[0]!, 'newest'), 'clip-2');
    assert.equal(keptCopy(GROUPS[1]!, 'newest'), 'song-2');
    assert.deepEqual([...initialDuplicateSelection(GROUPS, 'newest')].sort(), ['clip-1', 'clip-3', 'song-1']);
  });

  test('keep oldest: every group keeps its oldest copy (an unknown date counts as oldest)', () => {
    assert.equal(keptCopy(GROUPS[0]!, 'oldest'), 'clip-1');
    assert.equal(keptCopy(GROUPS[1]!, 'oldest'), 'song-1');
    assert.deepEqual([...initialDuplicateSelection(GROUPS, 'oldest')].sort(), ['clip-2', 'clip-3', 'song-2']);
  });

  test('never every copy: the last unselected copy can’t be selected, and a fully selected group still keeps one', () => {
    let selected = initialDuplicateSelection(GROUPS);
    // clip-2 is the only copy left in its group: tapping it does nothing.
    selected = toggleDuplicate(selected, GROUPS[0]!, 'clip-2');
    assert.ok(!selected.has('clip-2'));
    // Unselect one, then the kept copy can be selected instead.
    selected = toggleDuplicate(selected, GROUPS[0]!, 'clip-1');
    selected = toggleDuplicate(selected, GROUPS[0]!, 'clip-2');
    assert.deepEqual([...selected].filter((id) => id.startsWith('clip')).sort(), ['clip-2', 'clip-3']);
    // The safety net: even a whole group handed in keeps its newest copy.
    const all = new Set(['clip-1', 'clip-2', 'clip-3', 'song-1', 'song-2']);
    assert.deepEqual(duplicatesToDelete(GROUPS, all).sort(), ['clip-1', 'clip-3', 'song-1']);
  });
});
