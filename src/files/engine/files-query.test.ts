import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { computeFolderStats, computeTypeCounts, listFolderEntries, type FilesItemInput } from './files-query';
import type { FolderNode } from './folder-tree';

function folder(id: string, parentId: string | null, name = id.toUpperCase(), createdAt = '2026-11-01T00:00:00Z'): FolderNode {
  return { id, name, parentId, createdAt, updatedAt: createdAt };
}

function item(id: string, folderId: string | null, extra: Partial<FilesItemInput> = {}): FilesItemInput {
  return {
    id,
    displayName: id,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: '100',
    downloadedAt: '2026-11-10T00:00:00Z',
    folderId,
    ...extra,
  };
}

// A › B, C (root)
const FOLDERS = [folder('a', null), folder('b', 'a'), folder('c', null)];
const ITEMS = [
  item('v1', null, { displayName: 'Zebra', fileSize: '500', downloadedAt: '2026-11-01T00:00:00Z' }),
  item('v2', null, { displayName: 'apple', fileSize: '50', downloadedAt: '2026-11-20T00:00:00Z' }),
  item('v3', 'a', { fileSize: '1000' }),
  item('v4', 'b', { fileSize: '2000' }),
  item('s1', 'b', { fileName: 'song.mp3', mimeType: 'audio/mpeg', fileSize: '30' }),
  item('orphan', 'deleted-folder', { displayName: 'Mango' }),
];

describe('listFolderEntries', () => {
  test('root: top-level folders and files, orphans show at the root', () => {
    const r = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null });
    assert.deepEqual(r.folders.map((x) => x.id), ['a', 'c']);
    assert.deepEqual(r.files.map((x) => x.id), ['v2', 'orphan', 'v1']); // name asc, case-insensitive
    assert.equal(r.files.find((x) => x.id === 'orphan')!.folderId, null);
  });

  test('a nested folder', () => {
    const r = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: 'b' });
    assert.deepEqual(r.folders, []);
    assert.deepEqual(r.files.map((x) => x.id).sort(), ['s1', 'v4']);
    assert.equal(r.files.find((x) => x.id === 's1')!.fileType, 'audio');
  });

  test('sort by size desc and date asc', () => {
    const bySize = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null, options: { sort: { by: 'size', dir: 'desc' } } });
    assert.deepEqual(bySize.files.map((x) => x.id), ['v1', 'orphan', 'v2']);
    const byDate = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null, options: { sort: { by: 'date', dir: 'asc' } } });
    assert.equal(byDate.files[0]!.id, 'v1');
  });

  test('ties keep a stable order whatever the input order', () => {
    const same = [item('k2', null, { displayName: 'Same' }), item('k1', null, { displayName: 'Same' })];
    const r1 = listFolderEntries({ folders: [], items: same, folderId: null });
    const r2 = listFolderEntries({ folders: [], items: [...same].reverse(), folderId: null });
    assert.deepEqual(r1.files.map((x) => x.id), r2.files.map((x) => x.id));
  });

  test('type filter lists that type from every folder and no folders', () => {
    const r = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null, options: { type: 'video' } });
    assert.deepEqual(r.folders, []);
    assert.deepEqual(r.files.map((x) => x.id).sort(), ['orphan', 'v1', 'v2', 'v3', 'v4']);
  });

  test('hidden files are left out unless includeHidden', () => {
    const hidden = new Set(['v1']);
    const r = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null, hiddenIds: hidden });
    assert.ok(!r.files.some((x) => x.id === 'v1'));
    const all = listFolderEntries({ folders: FOLDERS, items: ITEMS, folderId: null, hiddenIds: hidden, options: { includeHidden: true } });
    assert.ok(all.files.some((x) => x.id === 'v1'));
  });

  test('2,000 items list in well under 100 ms', () => {
    const many = Array.from({ length: 2000 }, (_, i) => item(`m${i}`, i % 2 ? 'a' : null, { displayName: `File ${i}` }));
    const started = performance.now();
    listFolderEntries({ folders: FOLDERS, items: many, folderId: 'a' });
    assert.ok(performance.now() - started < 100);
  });
});

describe('computeFolderStats', () => {
  test('counts include subfolders', () => {
    const stats = computeFolderStats(['a', 'b', 'c', 'nope'], FOLDERS, ITEMS);
    assert.deepEqual(stats.a, { itemCount: 3, totalBytes: 3030 });
    assert.deepEqual(stats.b, { itemCount: 2, totalBytes: 2030 });
    assert.deepEqual(stats.c, { itemCount: 0, totalBytes: 0 });
    assert.equal(stats.nope, undefined);
  });

  test('bad sizes count as 0 bytes', () => {
    const stats = computeFolderStats(['c'], FOLDERS, [item('x', 'c', { fileSize: 'abc' })]);
    assert.deepEqual(stats.c, { itemCount: 1, totalBytes: 0 });
  });
});

describe('computeTypeCounts', () => {
  test('every type is present, counts and bytes add up', () => {
    const counts = computeTypeCounts(ITEMS);
    assert.deepEqual(counts.video, { count: 5, bytes: 3650 });
    assert.deepEqual(counts.audio, { count: 1, bytes: 30 });
    assert.deepEqual(counts.apk, { count: 0, bytes: 0 });
    assert.equal(Object.keys(counts).length, 7);
  });
});
