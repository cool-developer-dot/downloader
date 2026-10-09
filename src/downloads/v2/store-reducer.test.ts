import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { DownloadItem } from '@/api/types';

import { projectV2Download, projectV2LibraryItem } from './projection';
import {
  isEngineOwned,
  mergeEngineRowsIntoPage,
  reduceEngineEntries,
  reduceEngineProgress,
  reduceEngineRemoval,
  type EngineViewState,
} from './store-reducer';
import { downloadRecord, libraryItem } from './test-fixtures';

function emptyState(overrides: Partial<EngineViewState> = {}): EngineViewState {
  return {
    itemsById: {},
    orderedIds: [],
    transferById: {},
    total: 0,
    statusFilter: 'all',
    query: '',
    sort: 'newest',
    engineRowsById: {},
    libraryOnlyIds: {},
    ...overrides,
  };
}

function v1Row(id: string, createdAt: string): DownloadItem {
  return {
    id,
    userId: '',
    title: `v1 ${id}`,
    sourceUrl: 'https://example.com/v1.mp4',
    platform: 'OTHER',
    thumbnailUrl: '',
    fileName: 'v1.mp4',
    folderId: null,
    fileSize: '10',
    status: 'COMPLETED',
    progress: 100,
    quality: null,
    resolution: null,
    bitrate: null,
    mimeType: null,
    container: null,
    retryCount: 0,
    workerState: 'COMPLETED',
    errorCode: null,
    errorMessage: null,
    downloadedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('the downloads view mirrors the v2 engine', () => {
  test('6: an engine row is added once and its progress updates in place', () => {
    let state = emptyState();
    const queued = projectV2Download(downloadRecord({ state: 'queued' }));
    state = { ...state, ...reduceEngineEntries(state, [queued]) };
    assert.deepEqual(state.orderedIds, ['dl-1']);
    assert.equal(state.total, 1);
    assert.ok(isEngineOwned(state, 'dl-1'));

    const downloading = projectV2Download(downloadRecord({ state: 'downloading', bytesDone: 524_288 }));
    state = { ...state, ...reduceEngineEntries(state, [downloading]) };
    assert.deepEqual(state.orderedIds, ['dl-1'], 'the same download is never a second row');

    const patch = reduceEngineProgress(state, {
      id: 'dl-1',
      phase: 'download',
      bytesDone: 4_194_304,
      totalBytes: 5_242_880,
      fraction: 0.8,
      speedBps: 900_000,
      etaSeconds: 1,
    });
    assert.ok(patch);
    state = { ...state, ...patch };
    assert.equal(state.itemsById['dl-1']?.progress, 80);
    assert.equal(state.transferById['dl-1']?.bytesWritten, 4_194_304);
  });

  test('a stale state event never rewinds visible progress', () => {
    let state = emptyState();
    state = { ...state, ...reduceEngineEntries(state, [projectV2Download(downloadRecord({ state: 'downloading', bytesDone: 4_000_000 }))]) };
    state = { ...state, ...reduceEngineEntries(state, [projectV2Download(downloadRecord({ state: 'downloading', bytesDone: 1_000 }))]) };
    assert.equal(state.transferById['dl-1']?.bytesWritten, 4_000_000);
  });

  test('rows follow the status filter without being forgotten', () => {
    let state = emptyState({ statusFilter: 'completed' });
    state = { ...state, ...reduceEngineEntries(state, [projectV2Download(downloadRecord({ state: 'downloading' }))]) };
    assert.deepEqual(state.orderedIds, [], 'a running download is not in the Completed filter');
    assert.ok(isEngineOwned(state, 'dl-1'), 'but it is still mirrored');

    state = {
      ...state,
      ...reduceEngineEntries(state, [projectV2Download(downloadRecord({ state: 'completed' }), { library: libraryItem() })]),
    };
    assert.deepEqual(state.orderedIds, ['dl-1']);

    // Switching back to "all" re-merges every mirrored row.
    const allView = mergeEngineRowsIntoPage({ ...state, statusFilter: 'all' }, { itemsById: {}, orderedIds: [], total: 0 }, true);
    assert.deepEqual(allView.orderedIds, ['dl-1']);
  });

  test('10: a v1 catalog page never duplicates or stands in for a v2 row', () => {
    const base = emptyState();
    const state = {
      ...base,
      ...reduceEngineEntries(base, [projectV2LibraryItem(libraryItem({ id: 'shared', title: 'Moved into the v2 library' }))]),
    };
    const page = mergeEngineRowsIntoPage(
      state,
      {
        // The v1 catalog still lists the same id (its file was moved into the v2 library) plus a v1-only row.
        itemsById: { shared: v1Row('shared', '2026-01-01T00:00:00.000Z'), older: v1Row('older', '2025-01-01T00:00:00.000Z') },
        orderedIds: ['shared', 'older'],
        total: 2,
      },
      true,
    );

    assert.equal(
      page.orderedIds.filter((id) => id === 'shared').length,
      0,
      'a video that exists only in the library belongs to Player, and the stale v1 row must not stand in for it',
    );
    assert.equal(page.itemsById['older']?.title, 'v1 older', 'unrelated v1 rows stay');
    assert.equal(page.total, 1);
  });

  test('a deleted library item drops the row', () => {
    const base = emptyState();
    const state = { ...base, ...reduceEngineEntries(base, [projectV2LibraryItem(libraryItem())]) };
    const after = { ...state, ...reduceEngineRemoval(state, ['dl-1']) };
    assert.deepEqual(after.orderedIds, []);
    assert.equal(after.total, 0);
    assert.equal(isEngineOwned(after, 'dl-1'), false);
  });
});

describe('removing a finished download from the list', () => {
  test('the video stays available to Player but leaves the Downloads page', () => {
    const base = emptyState();
    const started = {
      ...base,
      ...reduceEngineEntries(base, [projectV2Download(downloadRecord({ id: 'dl-1', state: 'completed' }))]),
    };
    assert.deepEqual(started.orderedIds, ['dl-1'], 'a completed download is listed while its record exists');

    // The record is gone; only the library item is left.
    const afterRemoval = {
      ...started,
      ...reduceEngineEntries(started, [projectV2LibraryItem(libraryItem({ id: 'dl-1' }))]),
    };

    assert.deepEqual(afterRemoval.orderedIds, [], 'the row leaves the Downloads list');
    assert.ok(afterRemoval.engineRowsById['dl-1'], 'and the video is still there for Player');
    assert.deepEqual(afterRemoval.libraryOnlyIds, { 'dl-1': true });

    const page = mergeEngineRowsIntoPage(afterRemoval, { itemsById: {}, orderedIds: [], total: 0 }, true);
    assert.deepEqual(page.orderedIds, [], 'and it does not come back when the page reloads');
  });
});

describe('a large library mirrors in linear time', () => {
  test('hydrating thousands of library-only videos marks each once and lists none of them', () => {
    const entries = Array.from({ length: 5_000 }, (_, i) =>
      projectV2LibraryItem(libraryItem({ id: `lib-${i}` })),
    );
    const started = performance.now();
    const next = reduceEngineEntries(emptyState(), entries);
    const elapsed = performance.now() - started;
    assert.equal(Object.keys(next.libraryOnlyIds).length, 5_000);
    assert.equal(Object.keys(next.engineRowsById).length, 5_000);
    assert.deepEqual(next.orderedIds, []);
    // Before: every entry copied the whole libraryOnlyIds map (12.5 M key copies for 5,000 videos).
    assert.ok(elapsed < 1_500, `took ${elapsed} ms`);
  });
});
