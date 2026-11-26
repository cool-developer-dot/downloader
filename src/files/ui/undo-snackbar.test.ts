import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createUndoSnackbar, UNDO_VISIBLE_MS } from './undo-snackbar';

/** A mock of F13's `deleteItems`: with the bin on everything is trashed; with it off everything is deleted. */
function mockDeleteItems(binOn: boolean) {
  return async (ids: string[]) => (binOn ? { trashed: [...ids], deleted: [] as string[] } : { trashed: [] as string[], deleted: [...ids] });
}

describe('Files F8 #804: the Undo bar', () => {
  test('one bar per batch: a delete of 3 files is one offer for 3, and Undo brings back exactly those', async () => {
    let now = 1_000;
    const bar = createUndoSnackbar(() => now);
    const offer = bar.show(await mockDeleteItems(true)(['a', 'b', 'c']), 3);
    assert.deepEqual(bar.get(), offer);
    assert.deepEqual(offer.trashedIds, ['a', 'b', 'c']);
    assert.equal(offer.failedCount, 0);
    now += UNDO_VISIBLE_MS - 1;
    assert.deepEqual(bar.take(offer.batchId), ['a', 'b', 'c']);
    // Undo works once: the bar is gone after it.
    assert.equal(bar.get(), null);
    assert.equal(bar.take(offer.batchId), null);
  });

  test('a second delete replaces the first: the first batch can no longer be undone', async () => {
    const bar = createUndoSnackbar(() => 0);
    const first = bar.show(await mockDeleteItems(true)(['a']), 1);
    const second = bar.show(await mockDeleteItems(true)(['b', 'c']), 2);
    assert.notEqual(first.batchId, second.batchId);
    assert.equal(bar.take(first.batchId), null);
    // Hiding the first batch's bar leaves the second one up.
    bar.dismiss(first.batchId);
    assert.deepEqual(bar.get()?.trashedIds, ['b', 'c']);
    assert.deepEqual(bar.take(second.batchId), ['b', 'c']);
  });

  test('Undo after the timeout does nothing; Android’s longer accessibility timeout is honoured', async () => {
    let now = 0;
    const bar = createUndoSnackbar(() => now);
    const offer = bar.show(await mockDeleteItems(true)(['a']), 1);
    now = UNDO_VISIBLE_MS;
    assert.equal(bar.take(offer.batchId), null);

    const longer = bar.show(await mockDeleteItems(true)(['b']), 1);
    bar.extend(longer.batchId, 10_000);
    bar.extend(longer.batchId, 1_000); // never shorter
    now = UNDO_VISIBLE_MS + 9_000;
    assert.deepEqual(bar.take(longer.batchId), ['b']);
  });

  test('with the bin off there is nothing to undo; a file that couldn’t go anywhere is counted as failed', async () => {
    const bar = createUndoSnackbar(() => 0);
    const off = bar.show(await mockDeleteItems(false)(['a', 'b']), 2);
    assert.equal(off.deletedCount, 2);
    assert.deepEqual(off.trashedIds, []);
    assert.equal(bar.take(off.batchId), null);
    const partial = bar.show({ trashed: ['a'], deleted: [] }, 3);
    assert.equal(partial.failedCount, 2);
  });
});
