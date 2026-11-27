import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { countByKind } from '@/screens/library/utils/library-kind';

import { fileExtension, fileTypeOf } from './file-types';
import { fileLabel } from './file-fields';
import { buildFilesIndex, fileDisplayName, folderPathIn, folderStatsIn, listFolderIn, typeCountsOf } from './files-index';
import { folderLookupOf, folderSubtreeIds, nearestExistingFolder, parentFolderId } from './folder-tree';
import { libraryItem } from './test-fixtures';

const item = (id: string, fileName: string, folderId: string | null = null, fileSize = '100', mimeType: string | null = null) =>
  libraryItem({ id, displayName: fileName, fileName, mimeType, fileSize, folderId });

describe('Files F1 stand-in for F12: fileTypeOf', () => {
  test('the MIME type decides; a missing or generic one falls back to the extension; anything else is other', () => {
    assert.equal(fileTypeOf({ mimeType: 'video/mp4', fileName: 'x.m4a' }), 'video');
    assert.equal(fileTypeOf({ mimeType: 'audio/mp4', fileName: 'x.mp4' }), 'audio');
    assert.equal(fileTypeOf({ mimeType: 'image/webp', fileName: 'x' }), 'image');
    assert.equal(fileTypeOf({ mimeType: 'application/pdf', fileName: 'x' }), 'doc');
    assert.equal(fileTypeOf({ mimeType: 'application/zip', fileName: 'x' }), 'archive');
    assert.equal(fileTypeOf({ mimeType: 'application/vnd.android.package-archive', fileName: 'x' }), 'apk');
    assert.equal(fileTypeOf({ mimeType: 'application/octet-stream', fileName: 'Clip.MKV' }), 'video');
    assert.equal(fileTypeOf({ mimeType: null, fileName: 'song.flac' }), 'audio');
    assert.equal(fileTypeOf({ mimeType: null, fileName: 'notes.docx' }), 'doc');
    assert.equal(fileTypeOf({ mimeType: null, fileName: 'bundle.7z' }), 'archive');
    assert.equal(fileTypeOf({ mimeType: null, fileName: 'app.xapk' }), 'apk');
    assert.equal(fileTypeOf({ mimeType: null, fileName: 'mystery.xyz' }), 'other');
    assert.equal(fileTypeOf({ mimeType: null, fileName: '.mp4' }), 'other');
    assert.equal(fileTypeOf({}), 'other');
  });

  test('the extension: lower case, without the dot; none for ".mp4" or a trailing dot', () => {
    assert.equal(fileExtension('a.b.MP4'), 'mp4');
    assert.equal(fileExtension('.mp4'), '');
    assert.equal(fileExtension('name.'), '');
    assert.equal(fileExtension('noext'), '');
    assert.equal(fileExtension(null), '');
  });
});

describe('Files F1 stand-in for F12: listing, stats and paths', () => {
  test('flat folders today: the top level lists every folder plus the unfiled files; a folder lists its own files', () => {
    const index = buildFilesIndex(
      [item('1', 'a.mp4', 'f1', '100'), item('2', 'b.mp4', null, '50'), item('3', 'c.mp3', 'f2', '25')],
      [
        { id: 'f1', name: 'Movies' },
        { id: 'f2', name: 'Music' },
      ],
    );
    const root = listFolderIn(index, null);
    assert.deepEqual(
      root.folders.map((folder) => folder.id),
      ['f1', 'f2'],
    );
    assert.deepEqual(
      root.files.map((file) => file.id),
      ['2'],
    );
    const movies = listFolderIn(index, 'f1');
    assert.deepEqual(movies.folders, []);
    assert.deepEqual(
      movies.files.map((file) => file.id),
      ['1'],
    );
    assert.deepEqual(folderStatsIn(index, 'f1'), { itemCount: 1, totalBytes: 100 });
    assert.deepEqual(
      folderPathIn(index, 'f1').map((folder) => folder.id),
      ['f1'],
    );
    assert.deepEqual(listFolderIn(index, 'gone'), { folders: [], files: [] });
  });

  test('nested once F12 adds parent ids: subfolders are listed and counted, size included', () => {
    const index = buildFilesIndex(
      [item('1', 'a.mp4', 'A', '100'), item('2', 'b.mp4', 'B', '200'), item('3', 'c.mp4', 'C', '300')],
      [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B', parentId: 'A' },
        { id: 'C', name: 'C', parentId: 'B' },
      ],
    );
    assert.deepEqual(
      listFolderIn(index, null).folders.map((folder) => folder.id),
      ['A'],
    );
    assert.deepEqual(
      listFolderIn(index, 'A').folders.map((folder) => folder.id),
      ['B'],
    );
    // A holds a.mp4 and B; B holds b.mp4 and C; C holds c.mp4 → 5 items under A.
    assert.deepEqual(folderStatsIn(index, 'A'), { itemCount: 5, totalBytes: 600 });
    assert.deepEqual(folderStatsIn(index, 'C'), { itemCount: 1, totalBytes: 300 });
    assert.deepEqual(
      folderPathIn(index, 'C').map((folder) => folder.id),
      ['A', 'B', 'C'],
    );
  });

  test('F5: a file shows its title (what Rename changes) with its file’s extension', () => {
    assert.equal(fileDisplayName('My trip', 'a1b2c3.mp4'), 'My trip.mp4');
    assert.equal(fileDisplayName('clip.MP4', 'clip.mp4'), 'clip.MP4');
    assert.equal(fileDisplayName('', 'clip.mp4'), 'clip.mp4');
    assert.equal(fileDisplayName('Notes', 'readme'), 'Notes');
    const index = buildFilesIndex([{ ...item('1', 'a1b2.mp3'), displayName: 'Song' }], []);
    assert.equal(fileLabel(index.files[0]!), 'Song.mp3');
    assert.equal(index.files[0]!.fileType, 'audio');
  });

  test('a file whose folder no longer exists is unfiled; duplicate ids keep their first entry', () => {
    const index = buildFilesIndex([item('1', 'a.mp4', 'deleted'), item('1', 'dup.mp4')], []);
    assert.equal(index.files.length, 1);
    assert.equal(index.files[0]!.folderId, null);
    assert.deepEqual(
      listFolderIn(index, null).files.map((file) => fileLabel(file)),
      ['a.mp4'],
    );
  });

  test('the Videos count equals the Player tab’s video count for a library of videos and audio', () => {
    // The Player tab counts every item that isn't audio as a video (`countByKind`); Files counts by `fileTypeOf`. The two
    // agree whenever the library holds only videos and audio — which is all the Player tab is meant to list.
    const items = [
      item('1', 'a.mp4', null, '1', 'video/mp4'),
      item('2', 'b.webm', null, '1', null),
      item('3', 'c.mp3', null, '1', 'audio/mpeg'),
      item('4', 'd.m4a', null, '1', null),
      item('5', 'e.mkv', null, '1', 'application/octet-stream'),
    ];
    const counts = typeCountsOf(buildFilesIndex(items, []).files);
    assert.equal(counts.video.count, countByKind(items).videos);
    assert.equal(counts.audio.count, countByKind(items).audio);
  });
});

describe('Files F1: the folder tree walks parent ids', () => {
  const folders = [
    { id: 'A', name: 'A', parentId: null },
    { id: 'B', name: 'B', parentId: 'A' },
    { id: 'C', name: 'C', parentId: 'B' },
    { id: 'L1', name: 'L1', parentId: 'L2' },
    { id: 'L2', name: 'L2', parentId: 'L1' },
  ];

  test('parents, subtrees (loop-safe), and the nearest existing folder of a deleted one', () => {
    const lookup = folderLookupOf(folders);
    assert.equal(parentFolderId('C', lookup), 'B');
    assert.equal(parentFolderId('L1', lookup), null);
    assert.deepEqual(folderSubtreeIds('A', folders).sort(), ['A', 'B', 'C']);
    assert.deepEqual(folderSubtreeIds('L1', folders).sort(), ['L1', 'L2']);
    // C was open and is gone; B still exists.
    assert.equal(nearestExistingFolder(['A', 'B'], (id) => id === 'A' || id === 'B'), 'B');
    // B is gone too: A.
    assert.equal(nearestExistingFolder(['A', 'B'], (id) => id === 'A'), 'A');
    // Nothing left: the Files tab.
    assert.equal(nearestExistingFolder(['A', 'B'], () => false), null);
    assert.equal(nearestExistingFolder([], () => true), null);
  });
});
