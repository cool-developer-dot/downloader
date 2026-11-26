import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FILE_TYPES } from '@/files/ui/file-types';
import type { FileEntry, FolderEntry } from '@/files/ui/files-index';

import { fileMetaLine, fileTypeIcon, folderListEntries, FILE_TYPE_ICONS } from './file-rows';

const file = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  id: name,
  name,
  title: name,
  type: 'video',
  mimeType: null,
  fileName: name,
  sizeBytes: 0,
  date: null,
  folderId: null,
  thumbnailUri: null,
  favorite: false,
  ...overrides,
});
const folder = (name: string): FolderEntry => ({ id: name, name, parentId: null, createdAt: null });

describe('Files F1 #779: file rows', () => {
  test('every FileType has its own icon, and an unknown type gets the plain file', () => {
    assert.deepEqual(FILE_TYPE_ICONS, {
      video: 'film',
      audio: 'music',
      image: 'image',
      doc: 'file-text',
      archive: 'file-archive',
      apk: 'package',
      other: 'file',
    });
    for (const type of FILE_TYPES) {
      assert.equal(fileTypeIcon(type), FILE_TYPE_ICONS[type]);
    }
    // Each known type's icon differs from the plain file and from every other type's.
    const known = FILE_TYPES.filter((type) => type !== 'other').map((type) => fileTypeIcon(type));
    assert.equal(new Set(known).size, known.length);
    assert.ok(!known.includes('file'));
    assert.equal(fileTypeIcon('not-a-type' as never), 'file');
    assert.equal(fileTypeIcon(null), 'file');
  });

  test('the "size · date" text, with whatever of the two is known', () => {
    const date = '2026-11-25T12:00:00.000Z';
    assert.equal(fileMetaLine(file('a.mp4', { sizeBytes: 1.5 * 1024 * 1024, date }), 'en-US'), '1.5 MB · Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { sizeBytes: 2 * 1024 ** 3, date }), 'en-US'), '2.00 GB · Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { sizeBytes: 512 }), 'en-US'), '512 B');
    assert.equal(fileMetaLine(file('a.mp4', { date }), 'en-US'), 'Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { date: 'not a date' }), 'en-US'), '');
  });

  test('folders first on: the subfolders by name, then the files by name', () => {
    const rows = folderListEntries([folder('b-folder'), folder('A-folder')], [file('c.mp4'), file('a.mp4')], { foldersFirst: true });
    assert.deepEqual(
      rows.map((row) => `${row.kind}:${row.kind === 'folder' ? row.folder.name : row.file.name}`),
      ['folder:A-folder', 'folder:b-folder', 'file:a.mp4', 'file:c.mp4'],
    );
  });

  test('folders first off: folders mix with files in name order', () => {
    const rows = folderListEntries([folder('D folder'), folder('B folder')], [file('c.mp4'), file('a.mp4')], { foldersFirst: false });
    assert.deepEqual(
      rows.map((row) => (row.kind === 'folder' ? row.folder.name : row.file.name)),
      ['a.mp4', 'B folder', 'c.mp4', 'D folder'],
    );
  });
});
