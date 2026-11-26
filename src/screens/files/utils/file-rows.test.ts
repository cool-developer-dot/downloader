import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { FILE_TYPES } from '@/files/ui/file-types';
import { fileLabel } from '@/files/ui/file-fields';
import { toFileEntry, type FileEntry, type FolderEntry } from '@/files/ui/files-index';
import { libraryItem } from '@/files/ui/test-fixtures';
import type { MediaLibraryItem } from '@/library/types';

import { fileMetaLine, fileTypeIcon, folderListEntries, FILE_TYPE_ICONS } from './file-rows';

const file = (name: string, overrides: Partial<MediaLibraryItem> = {}): FileEntry =>
  toFileEntry(libraryItem({ id: name, fileName: name, displayName: name, ...overrides }));
const folder = (name: string): FolderEntry => ({ id: name, name, parentId: null, createdAt: '', updatedAt: '' });

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
    assert.equal(fileMetaLine(file('a.mp4', { fileSize: String(1.5 * 1024 * 1024), downloadedAt: date }), 'en-US'), '1.5 MB · Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { fileSize: String(2 * 1024 ** 3), downloadedAt: date }), 'en-US'), '2.00 GB · Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { fileSize: '512' }), 'en-US'), '512 B');
    assert.equal(fileMetaLine(file('a.mp4', { downloadedAt: date }), 'en-US'), 'Nov 25, 2026');
    assert.equal(fileMetaLine(file('a.mp4', { downloadedAt: 'not a date' }), 'en-US'), '');
  });

  test('folders first on: the subfolders by name, then the files by name', () => {
    const rows = folderListEntries([folder('b-folder'), folder('A-folder')], [file('c.mp4'), file('a.mp4')], { foldersFirst: true });
    assert.deepEqual(
      rows.map((row) => `${row.kind}:${row.kind === 'folder' ? row.folder.name : fileLabel(row.file)}`),
      ['folder:A-folder', 'folder:b-folder', 'file:a.mp4', 'file:c.mp4'],
    );
  });

  test('folders first off: folders mix with files in name order', () => {
    const rows = folderListEntries([folder('D folder'), folder('B folder')], [file('c.mp4'), file('a.mp4')], { foldersFirst: false });
    assert.deepEqual(
      rows.map((row) => (row.kind === 'folder' ? row.folder.name : fileLabel(row.file))),
      ['a.mp4', 'B folder', 'c.mp4', 'D folder'],
    );
  });
});
