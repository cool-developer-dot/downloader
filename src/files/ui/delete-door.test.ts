import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDeleteDoor, downloadsDeleteRoute, wasDeleted, type DoorRequest, type DoorResult } from './delete-door';

type Source = 'files' | 'player' | 'downloads' | 'batch';

/** A door over a fake bin: what was asked, what reached deleteItems, what the bar showed. */
function fakeDoor(opts: { confirmOn: boolean; binOn?: boolean }) {
  const bin = new Set<string>();
  const deleted: string[] = [];
  const calls: { ids: string[]; source: Source }[] = [];
  const asked: DoorRequest<Source>[] = [];
  const bars: { result: DoorResult; requested: number }[] = [];
  const door = createDeleteDoor<Source>({
    deleteItems: async (ids, { source }) => {
      calls.push({ ids, source });
      if (opts.binOn === false) {
        deleted.push(...ids);
        return { trashed: [], deleted: ids };
      }
      ids.forEach((id) => bin.add(id));
      return { trashed: ids, deleted: [] };
    },
    confirmOn: () => opts.confirmOn,
    ask: (request) => asked.push(request),
    showBar: (result, requested) => bars.push({ result, requested }),
  });
  return { door, bin, deleted, calls, asked, bars };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Files F8: every delete goes through one door into the Recycle bin (Faran, 2026-11-28)', () => {
  test('each entry point’s delete reaches deleteItems with its own source, and lands in the bin with Undo', async () => {
    for (const source of ['files', 'batch', 'player', 'downloads'] as const) {
      const fake = fakeDoor({ confirmOn: false });
      let done: DoorResult | null = null;
      fake.door.request({ ids: ['a', 'a', 'b'], source, onDone: (result) => (done = result) });
      await flush();
      assert.deepEqual(fake.calls, [{ ids: ['a', 'b'], source }], source);
      assert.deepEqual([...fake.bin], ['a', 'b'], source);
      assert.deepEqual(fake.deleted, [], `${source}: nothing deleted while the bin is on`);
      assert.deepEqual(fake.bars, [{ result: { trashed: ['a', 'b'], deleted: [] }, requested: 2 }], `${source}: the Undo bar`);
      assert.deepEqual(done, { trashed: ['a', 'b'], deleted: [] });
    }
  });

  test('F2’s Confirm before delete: on, it only asks; nothing is deleted until Confirm', async () => {
    const fake = fakeDoor({ confirmOn: true });
    fake.door.request({ ids: ['a'], source: 'downloads', name: 'clip.mp4' });
    await flush();
    assert.equal(fake.asked.length, 1);
    assert.deepEqual(fake.calls, []);
    // The dialog's Confirm runs it.
    await fake.door.run(fake.asked[0]!);
    assert.deepEqual([...fake.bin], ['a']);
  });

  test('the door hands deleteItems only the ids asked for: no other copy is touched', async () => {
    const fake = fakeDoor({ confirmOn: false, binOn: false });
    await fake.door.run({ ids: ['only-this'], source: 'player' });
    assert.deepEqual(fake.calls, [{ ids: ['only-this'], source: 'player' }]);
    assert.deepEqual(fake.deleted, ['only-this']);
  });

  test('a failed delete still shows the bar ("couldn’t be deleted") and calls onDone', async () => {
    const bars: DoorResult[] = [];
    let done = false;
    const door = createDeleteDoor<Source>({
      deleteItems: async () => {
        throw new Error('refused');
      },
      confirmOn: () => false,
      ask: () => undefined,
      showBar: (result) => bars.push(result),
    });
    const result = await door.run({ ids: ['x'], source: 'files', onDone: () => (done = true) });
    assert.deepEqual(result, { trashed: [], deleted: [] });
    assert.deepEqual(bars, [{ trashed: [], deleted: [] }]);
    assert.equal(done, true);
    assert.equal(wasDeleted(result, 'x'), false);
  });

  test('Downloads: a finished download goes through the door; an unfinished one keeps its remove', () => {
    assert.equal(downloadsDeleteRoute('COMPLETED'), 'door');
    for (const status of ['DOWNLOADING', 'PAUSED', 'FAILED', 'QUEUED', null, undefined]) {
      assert.equal(downloadsDeleteRoute(status), 'unfinished', String(status));
    }
  });
});
