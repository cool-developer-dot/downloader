import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { removeFromPlayQueue, setPlayQueue, setPlayQueueCurrent, setPlayQueueShuffle, usePlayQueueStore } from './play-queue.ts';
import { canQuickDelete, nextAfterQuickDelete, type QuickDeleteTarget } from './quick-delete.ts';

/** P9 #726: which videos the Player's Delete video offers, and what plays after it. */

const library: QuickDeleteTarget = {
  mediaId: 'dl-1',
  inLibrary: true,
  isDeviceVideo: false,
  isExternalFile: false,
  isStream: false,
};

describe('P9 #726 Quick Delete', () => {
  test('only a video in VidoraX’s library', () => {
    assert.equal(canQuickDelete(library), true);
    assert.equal(canQuickDelete({ ...library, mediaId: 'device:42', isDeviceVideo: true }), false, 'a gallery video');
    assert.equal(canQuickDelete({ ...library, mediaId: 'external:t', isExternalFile: true, inLibrary: false }), false);
    assert.equal(canQuickDelete({ ...library, mediaId: 'stream:s', isStream: true, inLibrary: false }), false);
    assert.equal(canQuickDelete({ ...library, inLibrary: false }), false, 'no library row (already gone)');
    assert.equal(canQuickDelete({ ...library, mediaId: null }), false);
    assert.equal(canQuickDelete({ ...library, mediaId: '  ' }), false);
  });

  test('the next video in the queue plays; the last one (or no queue) closes the Player', () => {
    assert.equal(nextAfterQuickDelete(['a', 'b', 'c'], 'a'), 'b');
    assert.equal(nextAfterQuickDelete(['a', 'b', 'c'], 'b'), 'c');
    assert.equal(nextAfterQuickDelete(['a', 'b', 'c'], 'c'), null);
    assert.equal(nextAfterQuickDelete([], 'a'), null);
    assert.equal(nextAfterQuickDelete(['x', 'y'], 'a'), null, 'not in the queue');
    // The queue's play order is followed (a shuffled queue is just another order).
    assert.equal(nextAfterQuickDelete(['c', 'a', 'b'], 'a'), 'b');
  });

  test('the Player’s order: the next video becomes current, then the deleted one leaves the queue (P6’s own calls)', () => {
    setPlayQueue(['a', 'b', 'c']);
    setPlayQueueCurrent('b');
    const next = nextAfterQuickDelete(usePlayQueueStore.getState().ids, 'b');
    assert.equal(next, 'c');
    removeFromPlayQueue('b');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'b', 'c'], 'the one playing can’t be removed');
    setPlayQueueCurrent(next);
    removeFromPlayQueue('b');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'c']);

    // Shuffled: the order kept for Shuffle off loses it too.
    setPlayQueue(['a', 'b', 'c', 'd']);
    setPlayQueueCurrent('a');
    setPlayQueueShuffle(true, 7);
    const shuffled = [...usePlayQueueStore.getState().ids];
    const after = nextAfterQuickDelete(shuffled, 'a');
    assert.equal(after, shuffled[1]);
    setPlayQueueCurrent(after);
    removeFromPlayQueue('a');
    assert.ok(!usePlayQueueStore.getState().ids.includes('a'));
    assert.ok(!(usePlayQueueStore.getState().original ?? []).includes('a'));

    // The last video: nothing next; the queue still loses it once nothing plays.
    setPlayQueue(['x', 'y']);
    setPlayQueueCurrent('y');
    assert.equal(nextAfterQuickDelete(usePlayQueueStore.getState().ids, 'y'), null);
    setPlayQueueCurrent(null);
    removeFromPlayQueue('y');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['x']);
  });
});
