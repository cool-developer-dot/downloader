import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadRecord, LibraryItem, VidoraMediaEvents } from '@modules/vidorax-media/src/VidoraMedia.types';

import { collectV2Entries, hydrateV2Downloads, subscribeV2Downloads, type V2BridgeSink } from './bridge';
import type { V2EnginePort } from './engine-port';
import type { V2DownloadEntry } from './projection';
import { downloadRecord, libraryItem } from './test-fixtures';

function fakeEngine(input: {
  downloads?: DownloadRecord[];
  library?: LibraryItem[];
}): V2EnginePort & { listeners: Partial<VidoraMediaEvents> } {
  const library = input.library ?? [];
  const listeners: Partial<VidoraMediaEvents> = {};
  return {
    listeners,
    listDownloads: async () => input.downloads ?? [],
    listLibrary: async ({ offset = 0, limit = 200 }) => ({
      items: library.slice(offset, offset + limit),
      total: library.length,
    }),
    getLibraryItem: async (id: string) => library.find((item) => item.id === id) ?? null,
    getLibraryItems: async (ids: string[]) => library.filter((item) => ids.includes(item.id)),
    addListener: (eventName: keyof VidoraMediaEvents, listener: never) => {
      listeners[eventName] = listener;
      return { remove: () => delete listeners[eventName] };
    },
  } as unknown as V2EnginePort & { listeners: Partial<VidoraMediaEvents> };
}

function recordingSink(): V2BridgeSink & { entries: Map<string, V2DownloadEntry>; removed: string[] } {
  const entries = new Map<string, V2DownloadEntry>();
  const removed: string[] = [];
  return {
    entries,
    removed,
    applyEntries: (next) => {
      for (const entry of next) {
        entries.set(entry.item.id, entry);
      }
    },
    applyProgress: () => {},
    removeEntries: (ids) => {
      removed.push(...ids);
      for (const id of ids) {
        entries.delete(id);
      }
    },
    rowOf: (id) => entries.get(id)?.item ?? null,
  };
}

describe('mirroring the engine after a restart', () => {
  test('10: active records and library items restore as one row each', async () => {
    const engine = fakeEngine({
      downloads: [
        downloadRecord({ id: 'active', state: 'downloading' }),
        downloadRecord({ id: 'done', state: 'completed' }),
        downloadRecord({ id: 'failed', state: 'failed', errorCode: 'NETWORK' }),
      ],
      library: [libraryItem({ id: 'done' }), libraryItem({ id: 'older' })],
    });
    const sink = recordingSink();

    const count = await hydrateV2Downloads(engine, sink);
    assert.equal(count, 4);
    assert.deepEqual([...sink.entries.keys()].sort(), ['active', 'done', 'failed', 'older']);
    assert.equal(sink.entries.get('done')?.transfer.localUri, libraryItem().fileUri);
    assert.equal(sink.entries.get('older')?.item.status, 'COMPLETED');

    // Hydrating again (screen refresh) keeps one row per id.
    await hydrateV2Downloads(engine, sink);
    assert.equal(sink.entries.size, 4);
  });

  test('a completed record whose library item was deleted is not restored', () => {
    const entries = collectV2Entries([downloadRecord({ id: 'gone', state: 'completed' })], []);
    assert.deepEqual(entries, []);
  });

  test('state, progress and library events keep the mirror truthful', async () => {
    const engine = fakeEngine({ library: [libraryItem({ id: 'dl-1' })] });
    const sink = recordingSink();
    const detach = subscribeV2Downloads(engine, sink);

    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ state: 'downloading' }) });
    assert.equal(sink.entries.get('dl-1')?.item.status, 'DOWNLOADING');

    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sink.entries.get('dl-1')?.item.status, 'COMPLETED');
    assert.equal(sink.entries.get('dl-1')?.transfer.localUri, libraryItem().fileUri);

    engine.listeners.onLibraryChange?.({ reason: 'deleted', ids: ['dl-1'] });
    assert.deepEqual(sink.removed, ['dl-1']);

    detach();
    assert.deepEqual(Object.keys(engine.listeners), []);
  });
});

describe('what counts as a successful download', () => {
  test('only a completion with its verified library item is reported, once per event', async () => {
    const engine = fakeEngine({ library: [libraryItem({ id: 'kept' })] });
    const completed: string[] = [];
    const sink = { ...recordingSink(), onCompleted: (id: string) => completed.push(id) };
    const detach = subscribeV2Downloads(engine, sink);

    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'kept', state: 'downloading' }) });
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'kept', state: 'completed' }) });
    // A COMPLETED record whose library item is already gone (deleted meanwhile) is not a success to count.
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'no-file', state: 'completed' }) });
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'bad', state: 'failed', errorCode: 'NETWORK' }) });
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(completed, ['kept']);
    detach();
  });

  test('a failing listener never disturbs the mirror', async () => {
    const engine = fakeEngine({ library: [libraryItem({ id: 'kept' })] });
    const sink = {
      ...recordingSink(),
      onCompleted: () => {
        throw new Error('storage full');
      },
    };
    const detach = subscribeV2Downloads(engine, sink);
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'kept', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sink.entries.get('kept')?.item.status, 'COMPLETED');
    detach();
  });
});
