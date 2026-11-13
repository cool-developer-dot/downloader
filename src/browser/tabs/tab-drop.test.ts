import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { placeDraggedTab } from './tab-drop';

describe('B2: dragging a tab in the list', () => {
  test('without grouping it swaps at half a row, as B1 always did', () => {
    assert.deepEqual(placeDraggedTab(2.4, 2, 0, 5, false), { slot: 2, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(2.5, 2, 0, 5, false), { slot: 3, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(1.5, 2, 0, 5, false), { slot: 1, dropOnto: 0 });
  });

  test('over a neighbour, the neighbour is the drop target', () => {
    assert.deepEqual(placeDraggedTab(2.5, 2, 0, 5, true), { slot: 2, dropOnto: 1 });
    assert.deepEqual(placeDraggedTab(1.5, 2, 0, 5, true), { slot: 2, dropOnto: -1 });
  });

  test('a small move is neither a swap nor a drop', () => {
    assert.deepEqual(placeDraggedTab(2.2, 2, 0, 5, true), { slot: 2, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(1.8, 2, 0, 5, true), { slot: 2, dropOnto: 0 });
  });

  test('covering most of the next row moves past it', () => {
    assert.deepEqual(placeDraggedTab(2.75, 2, 0, 5, true), { slot: 3, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(1.25, 2, 0, 5, true), { slot: 1, dropOnto: 0 });
  });

  test('a fast drag that stops lands where the finger is, and may be over the next tab', () => {
    assert.deepEqual(placeDraggedTab(4.1, 1, 0, 5, true), { slot: 4, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(3.5, 0, 0, 5, true), { slot: 3, dropOnto: 1 });
  });

  test('the ends of the allowed range: no slot and no target beyond them', () => {
    assert.deepEqual(placeDraggedTab(5.5, 5, 0, 5, true), { slot: 5, dropOnto: 0 });
    assert.deepEqual(placeDraggedTab(-0.5, 0, 0, 5, true), { slot: 0, dropOnto: 0 });
    // Pinned tabs 0..1, others 2..5: an unpinned tab never targets a pinned one.
    assert.deepEqual(placeDraggedTab(1.5, 2, 2, 5, true), { slot: 2, dropOnto: 0 });
  });
});
