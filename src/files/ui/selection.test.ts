import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  dragModeFor,
  EMPTY_SELECTION,
  inSelectionOrder,
  invertSelection,
  rangeSelection,
  selectAll,
  toggleSelection,
  withoutRemovedIds,
} from './selection';

const ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];
const sorted = (set: ReadonlySet<string>) => [...set].sort();

describe('Files F4: the selection', () => {
  test('the selected rows come back in the order they were picked, not list order', () => {
    const rows = ROWS.map((key) => ({ key }));
    let picked = toggleSelection(EMPTY_SELECTION, 'e');
    picked = toggleSelection(picked, 'b');
    picked = toggleSelection(picked, 'd');
    assert.deepEqual(
      inSelectionOrder(rows, picked).map((row) => row.key),
      ['e', 'b', 'd'],
    );
    // A row that is no longer shown is skipped; Select all follows the list.
    assert.deepEqual(
      inSelectionOrder(rows.slice(0, 4), picked).map((row) => row.key),
      ['b', 'd'],
    );
    assert.deepEqual(
      inSelectionOrder(rows, selectAll(ROWS)).map((row) => row.key),
      ROWS,
    );
  });

  test('toggle: a tap selects a row, a second tap unselects it', () => {
    const one = toggleSelection(EMPTY_SELECTION, 'b');
    assert.deepEqual(sorted(one), ['b']);
    assert.deepEqual(sorted(toggleSelection(one, 'd')), ['b', 'd']);
    assert.deepEqual(sorted(toggleSelection(one, 'b')), []);
  });

  test('range down from the anchor, and back up again gives the rows back', () => {
    const base = new Set(['f']);
    const mode = dragModeFor(base, 'b');
    assert.equal(mode, 'select');
    assert.deepEqual(sorted(rangeSelection(base, ROWS, 'b', 'e', mode)), ['b', 'c', 'd', 'e', 'f']);
    // Dragging back toward the anchor: c and d stay, e goes back to unselected.
    assert.deepEqual(sorted(rangeSelection(base, ROWS, 'b', 'd', mode)), ['b', 'c', 'd', 'f']);
    assert.deepEqual(sorted(rangeSelection(base, ROWS, 'b', 'b', mode)), ['b', 'f']);
  });

  test('range up from the anchor; starting on a selected row unselects the range', () => {
    assert.deepEqual(sorted(rangeSelection(EMPTY_SELECTION, ROWS, 'e', 'b', 'select')), ['b', 'c', 'd', 'e']);
    const base = new Set(ROWS);
    const mode = dragModeFor(base, 'd');
    assert.equal(mode, 'unselect');
    assert.deepEqual(sorted(rangeSelection(base, ROWS, 'd', 'b', mode)), ['a', 'e', 'f']);
    // An id that is not in the list changes nothing.
    assert.deepEqual(sorted(rangeSelection(base, ROWS, 'd', 'zz', mode)), ROWS);
  });

  test('select all, then invert selects nothing; invert again selects all', () => {
    const all = selectAll(ROWS);
    assert.deepEqual(sorted(all), ROWS);
    const none = invertSelection(all, ROWS);
    assert.equal(none.size, 0);
    assert.deepEqual(sorted(invertSelection(none, ROWS)), ROWS);
    assert.deepEqual(sorted(invertSelection(new Set(['a', 'c']), ROWS)), ['b', 'd', 'e', 'f']);
  });

  test('removed ids drop out of the selection (and an unchanged selection stays the same object)', () => {
    const selected = new Set(['a', 'c', 'x']);
    const after = withoutRemovedIds(selected, ['a', 'b', 'c']);
    assert.deepEqual(sorted(after), ['a', 'c']);
    const same = new Set(['a']);
    assert.equal(withoutRemovedIds(same, ROWS), same);
  });
});
