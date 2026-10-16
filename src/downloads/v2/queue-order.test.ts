import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import type { DownloadQueue, DownloadQueueState } from '@modules/vidorax-media/src/VidoraMedia.types';

import { setV2EngineForTests, type V2EnginePort } from './engine-port';
import {
  canAddQueue,
  canMove,
  canMoveQueue,
  DEFAULT_QUEUE_STATE,
  groupByQueue,
  isDefaultQueueState,
  isHeldDownload,
  MAIN_QUEUE_ID,
  MAX_QUEUES,
  movedWithin,
  newQueueId,
  normalizeQueueState,
  orderAfterMove,
  queueNameProblem,
  queueOf,
  withHeld,
  withNewQueue,
  withoutQueue,
  withQueueMoved,
  withRenamedQueue,
} from './queue-order';
import {
  isQueueOrderSupported,
  moveDownload,
  moveDownloadsToQueue,
  resetQueueOrderStoreForTests,
  saveQueues,
  setReorderMode,
  useQueueOrderStore,
} from './queue-order-store';

const MAIN: DownloadQueue = { id: MAIN_QUEUE_ID, name: 'Main', held: false };
const NIGHT: DownloadQueue = { id: 'q-night', name: 'Night', held: false };

function state(overrides: Partial<DownloadQueueState> = {}): DownloadQueueState {
  return { ...DEFAULT_QUEUE_STATE, ...overrides };
}

function downloads(...ids: string[]) {
  // Older first: a was created first.
  return ids.map((id, index) => ({ id, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
}

describe('H4 reorder', () => {
  test('nothing set: one Main queue, oldest first (first-come)', () => {
    assert.equal(isDefaultQueueState(DEFAULT_QUEUE_STATE), true);
    const groups = groupByQueue(DEFAULT_QUEUE_STATE, downloads('a', 'b', 'c'));
    assert.deepEqual(groups, [{ queue: MAIN, ids: ['a', 'b', 'c'] }]);
  });

  test('the user order comes first, the rest stay first-come', () => {
    const groups = groupByQueue(state({ order: ['c', 'b'] }), downloads('a', 'b', 'c', 'd'));
    assert.deepEqual(groups[0]?.ids, ['c', 'b', 'a', 'd']);
  });

  test('up, down, top and bottom move inside the list; the ends do not move further', () => {
    const ids = ['a', 'b', 'c', 'd'];
    assert.deepEqual(movedWithin(ids, 'c', 'up'), ['a', 'c', 'b', 'd']);
    assert.deepEqual(movedWithin(ids, 'b', 'down'), ['a', 'c', 'b', 'd']);
    assert.deepEqual(movedWithin(ids, 'd', 'top'), ['d', 'a', 'b', 'c']);
    assert.deepEqual(movedWithin(ids, 'a', 'bottom'), ['b', 'c', 'd', 'a']);
    assert.deepEqual(movedWithin(ids, 'a', 'up'), ids);
    assert.deepEqual(movedWithin(ids, 'x', 'top'), ids);
    assert.equal(canMove(ids, 'a', 'up'), false);
    assert.equal(canMove(ids, 'a', 'top'), false);
    assert.equal(canMove(ids, 'a', 'down'), true);
    assert.equal(canMove(ids, 'd', 'bottom'), false);
    assert.equal(canMove(ids, 'x', 'down'), false);
  });

  test('a move sends every shown download queue by queue; no change sends nothing', () => {
    const queues = state({ queues: [NIGHT, MAIN], assignments: { b: NIGHT.id } });
    const groups = groupByQueue(queues, downloads('a', 'b', 'c'));
    assert.deepEqual(
      groups.map((group) => group.ids),
      [['b'], ['a', 'c']],
    );
    assert.deepEqual(orderAfterMove(groups, 'c', 'top'), ['b', 'c', 'a']);
    assert.equal(orderAfterMove(groups, 'b', 'up'), null);
    assert.equal(orderAfterMove(groups, 'zzz', 'up'), null);
  });
});

describe('H4 queues', () => {
  test('queues are listed in their order, empty ones too, each download in its queue', () => {
    const queues = state({ queues: [MAIN, NIGHT], assignments: { b: NIGHT.id, x: 'gone' } });
    assert.equal(queueOf(queues, 'b'), NIGHT.id);
    assert.equal(queueOf(queues, 'x'), MAIN_QUEUE_ID);
    assert.equal(queueOf(queues, 'a'), MAIN_QUEUE_ID);
    const groups = groupByQueue(queues, downloads('a'));
    assert.deepEqual(
      groups.map((group) => [group.queue.id, group.ids]),
      [
        [MAIN_QUEUE_ID, ['a']],
        [NIGHT.id, []],
      ],
    );
  });

  test('a held queue holds its downloads; Main can never be held', () => {
    const held = withHeld([MAIN, NIGHT], NIGHT.id, true);
    assert.equal(held[1]?.held, true);
    const queues = state({ queues: held, assignments: { b: NIGHT.id } });
    assert.equal(isHeldDownload(queues, 'b'), true);
    assert.equal(isHeldDownload(queues, 'a'), false);
    assert.deepEqual(withHeld([MAIN], MAIN_QUEUE_ID, true), [MAIN]);
    assert.deepEqual(withHeld(held, NIGHT.id, false), [MAIN, NIGHT]);
  });

  test('add, rename, move and delete; Main stays', () => {
    const added = withNewQueue([MAIN], 'q-1', '  Later  ');
    assert.deepEqual(added[1], { id: 'q-1', name: 'Later', held: false });
    assert.equal(withRenamedQueue(added, 'q-1', ' Soon ')[1]?.name, 'Soon');
    assert.deepEqual(withRenamedQueue(added, MAIN_QUEUE_ID, 'X'), added);
    assert.deepEqual(
      withQueueMoved(added, 'q-1', 'up').map((queue) => queue.id),
      ['q-1', MAIN_QUEUE_ID],
    );
    assert.equal(canMoveQueue(added, MAIN_QUEUE_ID, 'up'), false);
    assert.deepEqual(withQueueMoved(added, MAIN_QUEUE_ID, 'up'), added);
    assert.deepEqual(withoutQueue(added, 'q-1'), [MAIN]);
    assert.deepEqual(withoutQueue(added, MAIN_QUEUE_ID), added);
  });

  test('names: not empty, at most 40, not taken (Main\'s translated name included)', () => {
    const queues = [MAIN, NIGHT];
    assert.equal(queueNameProblem('  ', queues), 'empty');
    assert.equal(queueNameProblem('x'.repeat(41), queues), 'too-long');
    assert.equal(queueNameProblem('night', queues), 'duplicate');
    assert.equal(queueNameProblem('Night', queues, { exceptId: NIGHT.id }), null);
    assert.equal(queueNameProblem('مرکزی', queues, { mainName: 'مرکزی' }), 'duplicate');
    assert.equal(queueNameProblem('Weekend', queues), null);
  });

  test('at most 10 queues; new ids are unique', () => {
    const many = Array.from({ length: MAX_QUEUES }, (_, index) => ({ id: `q-${index}`, name: `Q${index}`, held: false }));
    assert.equal(canAddQueue(many), false);
    assert.equal(canAddQueue([MAIN]), true);
    let calls = 0;
    const id = newQueueId([{ id: 'q-0', name: 'x', held: false }], () => (calls++ === 0 ? 0 : 0.5));
    assert.notEqual(id, 'q-0');
    assert.match(id, /^q-[a-z0-9]+$/);
  });

  test('what native returns is made safe: Main present and never held, bad entries dropped', () => {
    const normalized = normalizeQueueState({
      queues: [{ id: 'q-a', name: ' A ', held: true }, { id: 'bad id' }, { id: 'q-a', name: 'dup' }, { id: 'main', held: true }],
      assignments: { x: 'q-a', y: 'missing', z: 'main', w: 3 },
      order: ['x', 'x', 4, 'y'],
    });
    assert.deepEqual(normalized.queues, [
      { id: 'q-a', name: 'A', held: true },
      { id: 'main', name: 'Main', held: false },
    ]);
    assert.deepEqual(normalized.assignments, { x: 'q-a' });
    assert.deepEqual(normalized.order, ['x', 'y']);
    assert.deepEqual(normalizeQueueState(null), DEFAULT_QUEUE_STATE);
    assert.deepEqual(normalizeQueueState({ queues: [] }).queues, [MAIN]);
  });
});

describe('H4 store', () => {
  let calls: string[] = [];
  let answer: DownloadQueueState = DEFAULT_QUEUE_STATE;
  let fail = false;
  let release: (() => void) | null = null;

  function port(withQueues = true): V2EnginePort {
    const reply = async (name: string, value: unknown): Promise<DownloadQueueState> => {
      calls.push(`${name}:${JSON.stringify(value)}`);
      if (release === null) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (fail) {
        throw new Error('nope');
      }
      return answer;
    };
    const queueFns = withQueues
      ? {
          getDownloadQueues: async () => answer,
          setDownloadOrder: (ids: string[]) => reply('order', ids),
          moveDownloadsToQueue: (ids: string[], queueId: string) => reply('move', [ids, queueId]),
          setDownloadQueues: (queues: DownloadQueue[]) => reply('queues', queues.map((queue) => queue.id)),
        }
      : {};
    return queueFns as unknown as V2EnginePort;
  }

  beforeEach(() => {
    calls = [];
    answer = DEFAULT_QUEUE_STATE;
    fail = false;
    release = () => undefined;
    resetQueueOrderStoreForTests();
  });

  afterEach(() => {
    setV2EngineForTests(null);
    resetQueueOrderStoreForTests();
  });

  test('a build without queues has no Reorder mode and sends nothing', async () => {
    setV2EngineForTests(port(false));
    assert.equal(isQueueOrderSupported(), false);
    assert.equal(await saveQueues([MAIN]), false);
    assert.deepEqual(calls, []);
  });

  test('a move sends the whole shown order and shows what the engine answered', async () => {
    setV2EngineForTests(port());
    answer = state({ order: ['b', 'a'] });
    const groups = groupByQueue(DEFAULT_QUEUE_STATE, downloads('a', 'b'));
    assert.equal(await moveDownload(groups, 'b', 'up'), true);
    assert.deepEqual(calls, ['order:["b","a"]']);
    assert.deepEqual(useQueueOrderStore.getState().queueState.order, ['b', 'a']);
    assert.equal(await moveDownload(groups, 'a', 'up'), false, 'already at the top: nothing is sent');
    assert.equal(calls.length, 1);
  });

  test('a second tap while a change is saved is ignored', async () => {
    setV2EngineForTests(port());
    release = null;
    const first = moveDownloadsToQueue(['a'], NIGHT.id);
    const second = moveDownloadsToQueue(['b'], NIGHT.id);
    assert.equal(await second, false);
    assert.equal(useQueueOrderStore.getState().busy, true);
    (release as (() => void) | null)?.();
    assert.equal(await first, true);
    assert.deepEqual(calls, ['move:[["a"],"q-night"]']);
    assert.equal(useQueueOrderStore.getState().busy, false);
  });

  test('a failed change keeps what was shown and says so', async () => {
    setV2EngineForTests(port());
    useQueueOrderStore.setState({ queueState: state({ queues: [MAIN, NIGHT] }) });
    fail = true;
    assert.equal(await saveQueues([MAIN]), false);
    assert.equal(useQueueOrderStore.getState().failed, true);
    assert.deepEqual(useQueueOrderStore.getState().queueState.queues, [MAIN, NIGHT]);
  });

  test('entering Reorder mode reads the engine; leaving it keeps the order (the engine owns it)', async () => {
    setV2EngineForTests(port());
    answer = state({ queues: [MAIN, NIGHT] });
    setReorderMode(true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(useQueueOrderStore.getState().reorderMode, true);
    assert.deepEqual(useQueueOrderStore.getState().queueState.queues, [MAIN, NIGHT]);
    setReorderMode(false);
    assert.equal(useQueueOrderStore.getState().reorderMode, false);
    assert.deepEqual(useQueueOrderStore.getState().queueState.queues, [MAIN, NIGHT]);
  });
});
