import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_STORED_QUEUE,
  addToPlayQueue,
  appendToQueue,
  insertAfterCurrent,
  movePlayQueueItem,
  moveQueueItem,
  playNextInQueue,
  playQueueOnOpen,
  queueNeighbours,
  readStoredPlayQueue,
  removeFromPlayQueue,
  removeFromQueueIds,
  seededShuffle,
  setPlayQueue,
  setPlayQueueCurrent,
  setPlayQueueShuffle,
  shuffleAroundCurrent,
  toStoredPlayQueue,
  unshuffledOrder,
  usePlayQueueStore,
} from './play-queue';

describe('queueNeighbours', () => {
  const ids = ['a', 'b', 'c'];

  test('steps both ways inside the list', () => {
    assert.deepEqual(queueNeighbours(ids, 'b'), { previousId: 'a', nextId: 'c' });
  });

  test('has no previous at the start and no next at the end', () => {
    assert.deepEqual(queueNeighbours(ids, 'a'), { previousId: null, nextId: 'b' });
    assert.deepEqual(queueNeighbours(ids, 'c'), { previousId: 'b', nextId: null });
  });

  test('has neither for media outside the list', () => {
    assert.deepEqual(queueNeighbours(ids, 'z'), { previousId: null, nextId: null });
    assert.deepEqual(queueNeighbours([], 'a'), { previousId: null, nextId: null });
    assert.deepEqual(queueNeighbours(ids, null), { previousId: null, nextId: null });
  });
});

// ── P6: the queue keeps working as before for its callers (Faran's headset keys), and grows ───────────────────────

function reset(ids: readonly string[] | undefined, currentId: string | null = null) {
  setPlayQueue(ids);
  setPlayQueueCurrent(currentId);
}

/** The way the existing callers use the queue: the store's ids and queueNeighbours. */
function headsetNext(currentId: string): string | null {
  return queueNeighbours(usePlayQueueStore.getState().ids, currentId).nextId;
}
function headsetPrevious(currentId: string): string | null {
  return queueNeighbours(usePlayQueueStore.getState().ids, currentId).previousId;
}

describe('existing play-queue calls, as made today', () => {
  test('setPlayQueue sets exactly the list given, and undefined empties it', () => {
    setPlayQueue(['a', 'b', 'c']);
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'b', 'c']);
    assert.equal(headsetNext('b'), 'c');
    assert.equal(headsetPrevious('b'), 'a');
    setPlayQueue(undefined);
    assert.deepEqual(usePlayQueueStore.getState().ids, []);
    assert.equal(headsetNext('b'), null);
  });

  test('setPlayQueue copies the list (a later change to the caller’s array does not leak in)', () => {
    const list = ['a', 'b'];
    setPlayQueue(list);
    list.push('c');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'b']);
  });

  test('a new list while shuffled is taken exactly as given, and ends the shuffle', () => {
    reset(['a', 'b', 'c', 'd'], 'a');
    setPlayQueueShuffle(true, 7);
    setPlayQueue(['x', 'y']);
    const state = usePlayQueueStore.getState();
    assert.deepEqual(state.ids, ['x', 'y']);
    assert.equal(state.shuffled, false);
    assert.equal(state.original, null);
  });

  test('Next and Previous follow Shuffle, Play next and reordering', () => {
    reset(['a', 'b', 'c', 'd', 'e'], 'c');
    playNextInQueue('e', 'c');
    assert.equal(headsetNext('c'), 'e');
    movePlayQueueItem('e', 1);
    assert.equal(headsetNext('c'), 'd');
    setPlayQueueShuffle(true, 42);
    const shuffled = usePlayQueueStore.getState().ids;
    assert.equal(shuffled[0], 'c', 'the video playing comes first');
    assert.equal(headsetNext('c'), shuffled[1]);
    assert.equal(headsetPrevious('c'), null);
  });
});

describe('Shuffle (#542)', () => {
  test('the same seed gives the same order; every video is kept once', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    assert.deepEqual(seededShuffle(ids, 123), seededShuffle(ids, 123));
    assert.notDeepEqual(seededShuffle(ids, 123), seededShuffle(ids, 124));
    assert.deepEqual([...seededShuffle(ids, 5)].sort(), ids);
    assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'the input is not changed');
  });

  test('keeps the video playing first and shuffles the rest', () => {
    const order = shuffleAroundCurrent(['a', 'b', 'c', 'd', 'e'], 'c', 9);
    assert.equal(order[0], 'c');
    assert.deepEqual([...order].sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual([...shuffleAroundCurrent(['a', 'b'], 'z', 1)].sort(), ['a', 'b']);
  });

  test('turning it off restores the original order, with Play next and Add to queue in their places', () => {
    reset(['a', 'b', 'c', 'd'], 'b');
    setPlayQueueShuffle(true, 3);
    assert.equal(usePlayQueueStore.getState().shuffled, true);
    playNextInQueue('x', 'b');
    addToPlayQueue('y', 'b');
    removeFromPlayQueue('d');
    setPlayQueueShuffle(false);
    const state = usePlayQueueStore.getState();
    assert.deepEqual(state.ids, ['a', 'b', 'x', 'c', 'y']);
    assert.equal(state.shuffled, false);
    assert.equal(state.original, null);
  });

  test('turning it on twice reshuffles the original order, not the shuffled one', () => {
    reset(['a', 'b', 'c', 'd', 'e'], 'a');
    setPlayQueueShuffle(true, 11);
    setPlayQueueShuffle(true, 12);
    assert.deepEqual(usePlayQueueStore.getState().original, ['a', 'b', 'c', 'd', 'e']);
    setPlayQueueShuffle(false);
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'b', 'c', 'd', 'e']);
  });

  test('unshuffledOrder keeps what is left and puts unknown videos last', () => {
    assert.deepEqual(unshuffledOrder(['a', 'b', 'c'], ['c', 'z', 'a']), ['a', 'c', 'z']);
  });
});

describe('Play next (#620), Add to queue, remove and reorder (#619)', () => {
  test('Play next goes right after the video playing, moving it if already queued', () => {
    assert.deepEqual(insertAfterCurrent(['a', 'b', 'c'], 'x', 'a'), ['a', 'x', 'b', 'c']);
    assert.deepEqual(insertAfterCurrent(['a', 'b', 'c'], 'c', 'a'), ['a', 'c', 'b']);
    assert.deepEqual(insertAfterCurrent([], 'x', 'a'), ['a', 'x'], 'no queue yet: one starts with the video playing');
    assert.deepEqual(insertAfterCurrent(['a', 'b'], 'x', 'z'), ['x', 'a', 'b'], 'playing a video outside the queue');
    assert.deepEqual(insertAfterCurrent(['a', 'b'], 'a', 'a'), ['a', 'b'], 'the video playing stays');
  });

  test('Add to queue goes at the end, once', () => {
    assert.deepEqual(appendToQueue(['a', 'b'], 'x', 'a'), ['a', 'b', 'x']);
    assert.deepEqual(appendToQueue(['a', 'b'], 'b', 'a'), ['a', 'b']);
    assert.deepEqual(appendToQueue([], 'x', 'a'), ['a', 'x']);
    reset(['a', 'b'], 'a');
    assert.equal(addToPlayQueue('b', 'a'), 'already');
    assert.equal(addToPlayQueue('c', 'a'), 'added');
    assert.equal(playNextInQueue('c', 'a'), 'moved');
    assert.equal(playNextInQueue('c', 'a'), 'unchanged');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'c', 'b']);
  });

  test('the video playing can not be removed; others can', () => {
    assert.deepEqual(removeFromQueueIds(['a', 'b', 'c'], 'b', 'b'), ['a', 'b', 'c']);
    assert.deepEqual(removeFromQueueIds(['a', 'b', 'c'], 'c', 'b'), ['a', 'b']);
    reset(['a', 'b', 'c'], 'a');
    removeFromPlayQueue('a');
    removeFromPlayQueue('b');
    assert.deepEqual(usePlayQueueStore.getState().ids, ['a', 'c']);
  });

  test('moves one place up or down, nothing past either end', () => {
    assert.deepEqual(moveQueueItem(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(moveQueueItem(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(moveQueueItem(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
    assert.deepEqual(moveQueueItem(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
    assert.deepEqual(moveQueueItem(['a', 'b', 'c'], 'z', 1), ['a', 'b', 'c']);
  });
});

describe('opening the Player and restarts', () => {
  test('a given list replaces the queue; with none, the queue stays only for the video it was playing', () => {
    const state = { ids: ['a', 'b', 'c'], currentId: 'b' };
    assert.equal(playQueueOnOpen(state, 'x', ['x', 'y']), 'replace');
    assert.equal(playQueueOnOpen(state, 'b', undefined), 'keep', 'the mini player reopened, or a restart');
    assert.equal(playQueueOnOpen(state, 'c', undefined), 'replace', 'another video from a single place: no queue');
    assert.equal(playQueueOnOpen({ ids: [], currentId: 'b' }, 'b', undefined), 'replace');
  });

  test('the saved queue reads back, tolerantly', () => {
    const saved = toStoredPlayQueue({ ids: ['a', 'b'], original: ['b', 'a'], shuffled: true, currentId: 'b' });
    assert.deepEqual(readStoredPlayQueue(JSON.parse(JSON.stringify(saved))), saved);
    assert.equal(readStoredPlayQueue(null), null);
    assert.equal(readStoredPlayQueue({ ids: [] }), null);
    assert.deepEqual(readStoredPlayQueue({ ids: ['a', 'a', 3, 'b'], currentId: 'zz', shuffled: true }), {
      ids: ['a', 'b'],
      original: null,
      shuffled: false,
      currentId: null,
    });
    const long = Array.from({ length: MAX_STORED_QUEUE + 5 }, (_, i) => `v${i}`);
    assert.equal(readStoredPlayQueue({ ids: long })?.ids.length, MAX_STORED_QUEUE);
  });
});
