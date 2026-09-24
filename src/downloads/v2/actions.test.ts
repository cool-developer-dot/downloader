import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  pageFavoriteChange,
  removeEngineDownload,
  renameEngineLibraryItem,
  setEngineFavorite,
  retryEngineDownload,
  runEngineDownloadAction,
  type EngineDownloadAction,
} from './actions';
import type { V2EnginePort } from './engine-port';

function recordingEngine(options: { removeFails?: unknown } = {}): V2EnginePort & { calls: string[] } {
  const calls: string[] = [];
  const port = {
    calls,
    pause: async (id: string) => void calls.push(`pause:${id}`),
    resume: async (id: string) => void calls.push(`resume:${id}`),
    retry: async (id: string) => void calls.push(`retry:${id}`),
    cancel: async (id: string) => void calls.push(`cancel:${id}`),
    deleteLibraryItems: async (ids: string[]) => void calls.push(`deleteLibrary:${ids.join(',')}`),
    removeDownload: async (id: string) => {
      calls.push(`removeDownload:${id}`);
      if (options.removeFails) {
        throw options.removeFails;
      }
    },
  };
  return port as unknown as V2EnginePort & { calls: string[] };
}

describe('7: Downloads actions are the engine’s own operations', () => {
  for (const action of ['pause', 'resume', 'retry', 'cancel'] as EngineDownloadAction[]) {
    test(`${action} calls the engine once`, async () => {
      const engine = recordingEngine();
      await runEngineDownloadAction(engine, 'dl-1', action);
      assert.deepEqual(engine.calls, [`${action}:dl-1`]);
    });
  }

  test('without the native module the action fails instead of starting a v1 transfer', async () => {
    await assert.rejects(() => runEngineDownloadAction(null, 'dl-1', 'pause'), /unavailable/i);
  });

  test('removing a completed download keeps the video and only drops the row', async () => {
    const engine = recordingEngine();
    await removeEngineDownload(engine, 'dl-1', 'COMPLETED');
    assert.deepEqual(
      engine.calls,
      ['removeDownload:dl-1'],
      'the finished video stays in the library: only the download row goes',
    );
  });

  test('removing an active download cancels it first', async () => {
    const engine = recordingEngine();
    await removeEngineDownload(engine, 'dl-1', 'DOWNLOADING');
    assert.deepEqual(engine.calls, ['cancel:dl-1', 'removeDownload:dl-1']);
  });

  test('a library-only row with no download record removes cleanly', async () => {
    const engine = recordingEngine({ removeFails: Object.assign(new Error('gone'), { code: 'ERR_NOT_FOUND' }) });
    await removeEngineDownload(engine, 'legacy-1', 'COMPLETED');
    assert.deepEqual(engine.calls, ['removeDownload:legacy-1']);
  });

  test('a real removal failure is reported, never swallowed', async () => {
    const engine = recordingEngine({ removeFails: Object.assign(new Error('busy'), { code: 'ERR_INVALID_STATE' }) });
    await assert.rejects(() => removeEngineDownload(engine, 'dl-1', 'FAILED'), /busy/);
  });
});

describe('retry never loops a known-expired source (Phase 11C)', () => {
  test('an ordinary failure retries through the engine as before', async () => {
    const calls: string[] = [];
    const engine = { retry: async (id: string) => { calls.push(id); } } as unknown as V2EnginePort;
    const result = await retryEngineDownload(
      { id: 'dl-1', errorCode: 'NETWORK_ERROR', pageUrl: 'https://example.com/watch' },
      { engine },
    );
    assert.deepEqual(calls, ['dl-1']);
    assert.deepEqual(result, { ok: true, downloadId: 'dl-1', refreshed: false });
  });

  test('an expired source is never re-probed unchanged; the page is asked for a fresh link', async () => {
    const retried: string[] = [];
    const engine = { retry: async (id: string) => { retried.push(id); } } as unknown as V2EnginePort;
    const result = await retryEngineDownload(
      { id: 'dl-2', errorCode: 'SOURCE_EXPIRED', pageUrl: 'https://example.com/watch' },
      { engine, reenqueueFromLiveSource: async () => 'dl-2-fresh' },
    );
    assert.deepEqual(retried, [], 'the dead URL is never handed back to the engine');
    assert.deepEqual(result, { ok: true, downloadId: 'dl-2-fresh', refreshed: true });
  });

  test('a 403 with no refreshable source refuses with the actionable message', async () => {
    const retried: string[] = [];
    const engine = { retry: async (id: string) => { retried.push(id); } } as unknown as V2EnginePort;
    const result = await retryEngineDownload(
      { id: 'dl-3', errorCode: 'HTTP_403', pageUrl: null },
      { engine, reenqueueFromLiveSource: async () => null },
    );
    assert.deepEqual(retried, []);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'SOURCE_EXPIRED');
    assert.equal(
      result.ok === false && result.message,
      'Open the video page again to refresh the download link.',
    );
  });

  test('with no refresher at all, an expired retry still refuses instead of looping', async () => {
    const retried: string[] = [];
    const engine = { retry: async (id: string) => { retried.push(id); } } as unknown as V2EnginePort;
    const result = await retryEngineDownload(
      { id: 'dl-4', errorCode: 'SOURCE_EXPIRED', pageUrl: null },
      { engine },
    );
    assert.deepEqual(retried, []);
    assert.equal(result.ok, false);
  });
});

test('renaming a finished v2 video changes its library title and never touches the file', async () => {
  const calls: [string, string][] = [];
  const engine = {
    renameLibraryItem: async (id: string, title: string) => {
      calls.push([id, title]);
      return { id, title } as never;
    },
  } as unknown as V2EnginePort;

  assert.equal(await renameEngineLibraryItem(engine, 'dl-1', '  Harbour at dawn  '), 'Harbour at dawn');
  assert.deepEqual(calls, [['dl-1', 'Harbour at dawn']]);
  await assert.rejects(renameEngineLibraryItem(engine, 'dl-1', '   '), /Enter a name/);
  await assert.rejects(renameEngineLibraryItem(null, 'dl-1', 'x'), /unavailable/);
  await assert.rejects(renameEngineLibraryItem({} as V2EnginePort, 'dl-1', 'x'), /unavailable/);
  assert.equal(calls.length, 1);
});

test('a v2 favorite is its own; the page favorite follows the first and the last one only', async () => {
  const calls: [string, boolean][] = [];
  const engine = { setFavorite: async (id: string, favorite: boolean) => { calls.push([id, favorite]); } } as unknown as V2EnginePort;
  await setEngineFavorite(engine, 'dl-2', true);
  assert.deepEqual(calls, [['dl-2', true]]);
  await assert.rejects(setEngineFavorite(null, 'dl-2', true), /unavailable/);

  assert.equal(pageFavoriteChange({ favorite: true, pageFavorited: false, otherFavoritesOnPage: 0 }), 'add');
  assert.equal(pageFavoriteChange({ favorite: true, pageFavorited: true, otherFavoritesOnPage: 1 }), null);
  assert.equal(
    pageFavoriteChange({ favorite: false, pageFavorited: true, otherFavoritesOnPage: 1 }),
    null,
    'another video from the page is still a favorite: the page stays in Favorites',
  );
  assert.equal(pageFavoriteChange({ favorite: false, pageFavorited: true, otherFavoritesOnPage: 0 }), 'remove');
  assert.equal(pageFavoriteChange({ favorite: false, pageFavorited: false, otherFavoritesOnPage: 0 }), null);
});
