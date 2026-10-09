import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadRecord, LibraryItem, VidoraMediaEvents } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  collectV2Entries,
  hydrateV2ActiveDownloads,
  hydrateV2Downloads,
  subscribeV2Downloads,
  type V2BridgeSink,
} from './bridge';
import type { V2EnginePort } from './engine-port';
import { projectV2Download, type V2DownloadEntry } from './projection';
import { downloadRecord, libraryItem } from './test-fixtures';

function fakeEngine(input: {
  downloads?: DownloadRecord[];
  library?: LibraryItem[];
}): V2EnginePort & { listeners: Partial<VidoraMediaEvents>; removedDownloads: string[] } {
  const library = input.library ?? [];
  const listeners: Partial<VidoraMediaEvents> = {};
  const removedDownloads: string[] = [];
  return {
    listeners,
    listDownloads: async () => input.downloads ?? [],
    listLibrary: async ({ offset = 0, limit = 200 }) => ({
      items: library.slice(offset, offset + limit),
      total: library.length,
    }),
    getLibraryItem: async (id: string) => library.find((item) => item.id === id) ?? null,
    getLibraryItems: async (ids: string[]) => library.filter((item) => ids.includes(item.id)),
    removeDownload: async (id: string) => {
      removedDownloads.push(id);
    },
    removedDownloads,
    addListener: (eventName: keyof VidoraMediaEvents, listener: never) => {
      listeners[eventName] = listener;
      return { remove: () => delete listeners[eventName] };
    },
  } as unknown as V2EnginePort & { listeners: Partial<VidoraMediaEvents>; removedDownloads: string[] };
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

describe('a finished download never leaves the current screen', () => {
  test('announces "Video downloaded" once, and only while the app is in front', async () => {
    const engine = fakeEngine({
      library: [libraryItem({ id: 'a' }), libraryItem({ id: 'b' }), libraryItem({ id: 'c' })],
    });
    const announced: string[] = [];
    let state = 'active';
    let clock = 10_000;
    const sink = { ...recordingSink(), announceCompleted: (id: string) => announced.push(id) };
    const detach = subscribeV2Downloads(engine, sink, { appState: () => state, now: () => clock });

    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'a', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    // The engine repeating COMPLETED for the same download is not a new notice.
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'a', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(announced, ['a']);

    // In the background the system notification speaks instead.
    state = 'background';
    clock += 10_000;
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'b', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(announced, ['a']);

    state = 'active';
    clock += 10_000;
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'c', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(announced, ['a', 'c']);
    assert.equal(sink.entries.get('c')?.item.status, 'COMPLETED');
    detach();
  });

  test('a finished file that was a video the user already has says "Video already downloaded", once', async () => {
    const engine = fakeEngine({ library: [] });
    const duplicates: string[] = [];
    const completed: string[] = [];
    let state = 'active';
    const sink = {
      ...recordingSink(),
      announceCompleted: (id: string) => completed.push(id),
      announceDuplicate: (id: string) => duplicates.push(id),
    };
    const detach = subscribeV2Downloads(engine, sink, { appState: () => state, now: () => 50_000 });
    const duplicate = downloadRecord({ id: 'dup', state: 'failed', errorCode: 'DUPLICATE', errorMessage: 'Video already downloaded' });

    sink.applyEntries([projectV2Download(downloadRecord({ id: 'dup', state: 'processing' }))]);
    engine.listeners.onDownloadStateChange?.({ record: duplicate });
    engine.listeners.onDownloadStateChange?.({ record: duplicate });
    assert.deepEqual(duplicates, ['dup']);
    assert.deepEqual(completed, [], 'never announced as a new download');
    assert.equal(sink.entries.has('dup'), false, 'no failed row for a video the user already has');
    assert.ok(engine.removedDownloads.includes('dup'), 'the discarded record is removed from the engine');

    // Any other failure is not a duplicate; in the background the notification speaks instead.
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'net', state: 'failed', errorCode: 'NETWORK' }) });
    state = 'background';
    engine.listeners.onDownloadStateChange?.({ record: { ...duplicate, id: 'dup-2' } });
    assert.deepEqual(duplicates, ['dup']);
    detach();
  });

  test('a discarded duplicate left from an earlier run gets no row and is cleaned up at hydration', async () => {
    const engine = fakeEngine({
      downloads: [
        downloadRecord({ id: 'dup', state: 'failed', errorCode: 'DUPLICATE' }),
        downloadRecord({ id: 'net', state: 'failed', errorCode: 'NETWORK' }),
      ],
    });
    const sink = recordingSink();
    await hydrateV2ActiveDownloads(engine, sink);
    assert.deepEqual([...sink.entries.keys()], ['net']);
    assert.deepEqual(engine.removedDownloads, ['dup']);
  });

  test('a completion without its verified file is not announced', async () => {
    const engine = fakeEngine({ library: [] });
    const announced: string[] = [];
    const sink = { ...recordingSink(), announceCompleted: (id: string) => announced.push(id) };
    const detach = subscribeV2Downloads(engine, sink, { appState: () => 'active' });
    engine.listeners.onDownloadStateChange?.({ record: downloadRecord({ id: 'gone', state: 'completed' }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(announced, []);
    detach();
  });
});
