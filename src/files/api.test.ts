import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createFolder, FilesError, filesCapabilities, fileTypeOf, moveFolder, type FilesErrorCode, type FileType } from './api';
import { filesErrorFromFolderStore } from './ui/folder-errors';
import { atTheRoot, buildFilesIndex, folderPathIn, listFolderIn } from './ui/files-index';
import { libraryItem } from './ui/test-fixtures';

/** Awaits `run` and returns the FilesError code it rejected with (fails if it resolved or threw something else). */
async function codeOf(run: () => Promise<unknown>): Promise<FilesErrorCode> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof FilesError, `expected a FilesError, got ${String(error)}`);
    return error.code;
  }
  assert.fail('expected a FilesError');
}

describe('F12 contract (src/files/api.ts): fileTypeOf', () => {
  test('every FileType, by MIME type first and then by the extension', () => {
    const cases: [string | null | undefined, string, FileType][] = [
      ['video/mp4', 'clip.bin', 'video'],
      [null, 'clip.MKV', 'video'],
      ['audio/mpeg', 'song.bin', 'audio'],
      [undefined, 'voice.m4a', 'audio'],
      ['image/jpeg', 'x', 'image'],
      [null, 'photo.webp', 'image'],
      ['application/pdf', 'x', 'doc'],
      [null, 'notes.docx', 'doc'],
      ['application/zip', 'x', 'archive'],
      [null, 'bundle.7z', 'archive'],
      ['application/vnd.android.package-archive', 'x', 'apk'],
      [null, 'app.xapk', 'apk'],
      ['application/octet-stream', 'mystery.xyz', 'other'],
      [null, 'no-extension', 'other'],
    ];
    for (const [mime, fileName, expected] of cases) {
      assert.equal(fileTypeOf(mime, fileName), expected, `${String(mime)} ${fileName}`);
    }
    // A specific MIME type wins over a misleading extension.
    assert.equal(fileTypeOf('video/mp4', 'live.mp3'), 'video');
  });
});

describe('F12 contract: FilesError codes', () => {
  test('carries its code, defaults its message to the code, and is an Error', () => {
    const codes: FilesErrorCode[] = ['NAME_TAKEN', 'INVALID_NAME', 'TOO_DEEP', 'CYCLE', 'NOT_FOUND', 'NOT_SUPPORTED'];
    for (const code of codes) {
      const error = new FilesError(code);
      assert.ok(error instanceof Error);
      assert.equal(error.code, code);
      assert.equal(error.message, code);
    }
    assert.equal(new FilesError('CYCLE', 'Not inside itself').message, 'Not inside itself');
  });

  test('the folder store’s errors become NAME_TAKEN / INVALID_NAME; others pass through', () => {
    const taken = filesErrorFromFolderStore(new Error('A folder with this name already exists'));
    assert.ok(taken instanceof FilesError && taken.code === 'NAME_TAKEN');
    const empty = filesErrorFromFolderStore(new Error('Folder name is required'));
    assert.ok(empty instanceof FilesError && empty.code === 'INVALID_NAME');
    const other = new Error('Disk full');
    assert.equal(filesErrorFromFolderStore(other), other);
  });
});

describe('F12 contract: the fill-in until the engine lands', () => {
  test('nested folders are off: moveFolder and createFolder with a parent are NOT_SUPPORTED', async () => {
    assert.equal(filesCapabilities.nestedFolders, false);
    assert.equal(await codeOf(() => moveFolder('a', 'b')), 'NOT_SUPPORTED');
    assert.equal(await codeOf(() => moveFolder('a', null)), 'NOT_SUPPORTED');
    assert.equal(await codeOf(() => createFolder('Trips', 'parent')), 'NOT_SUPPORTED');
  });

  test('an empty name is INVALID_NAME', async () => {
    assert.equal(await codeOf(() => createFolder('   ', null)), 'INVALID_NAME');
  });

  test('every folder is at the root, and folderPath(id) is [thatFolder], or [] when unknown', () => {
    const index = buildFilesIndex(
      [libraryItem({ id: '1', fileName: 'a.mp4', folderId: 'B' })],
      atTheRoot([
        { id: 'A', name: 'A', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' },
        { id: 'B', name: 'B', parentId: 'A', createdAt: '2026-11-03T00:00:00.000Z' },
      ]),
    );
    assert.deepEqual(
      index.folders.map((folder) => folder.parentId),
      [null, null],
    );
    assert.deepEqual(
      listFolderIn(index, null).folders.map((folder) => folder.id),
      ['A', 'B'],
    );
    assert.deepEqual(folderPathIn(index, 'B'), [
      { id: 'B', name: 'B', parentId: null, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' },
    ]);
    assert.deepEqual(folderPathIn(index, 'missing'), []);
  });

  test('the type filter lists every file of that type, from the top level down', () => {
    const index = buildFilesIndex(
      [
        libraryItem({ id: '1', fileName: 'a.mp4', folderId: 'A' }),
        libraryItem({ id: '2', fileName: 'b.mp4' }),
        libraryItem({ id: '3', fileName: 'c.mp3', folderId: 'A' }),
      ],
      [{ id: 'A', name: 'A' }],
    );
    const videos = listFolderIn(index, null, { type: 'video' });
    assert.deepEqual(videos.folders, []);
    assert.deepEqual(
      videos.files.map((file) => file.id),
      ['1', '2'],
    );
    assert.deepEqual(
      listFolderIn(index, null, { type: 'video', sort: { by: 'name', dir: 'desc' } }).files.map((file) => file.id),
      ['2', '1'],
    );
  });
});
