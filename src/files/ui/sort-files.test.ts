import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { FileType } from './file-types';
import { FILES_SORT_DIRECTIONS, FILES_SORT_KEYS } from './files-view-settings';
import { sortFileRows, type SortFields, type SortOptions } from './sort-files';

type Row = SortFields & { id: string };

const file = (id: string, name: string, date: string | null, sizeBytes: number, type: FileType): Row => ({
  id,
  isFolder: false,
  name,
  date,
  sizeBytes,
  type,
});
const folder = (id: string, name: string, date: string | null, sizeBytes: number): Row => ({
  id,
  isFolder: true,
  name,
  date,
  sizeBytes,
  type: null,
});

const FILES: Row[] = [
  file('song', 'song.mp3', '2026-03-01T00:00:00Z', 300, 'audio'),
  file('clip10', 'clip10.mp4', '2026-01-01T00:00:00Z', 500, 'video'),
  file('guide', 'Guide.pdf', '2026-02-01T00:00:00Z', 100, 'doc'),
  file('clip2', 'clip2.mp4', '2026-04-01T00:00:00Z', 200, 'video'),
  file('app', 'app.apk', '2026-05-01T00:00:00Z', 400, 'apk'),
];

const order = (rows: Row[], options: Partial<SortOptions>) =>
  sortFileRows(rows, (row) => row, { sortKey: 'name', sortDirection: 'asc', foldersFirst: true, ...options }).map((row) => row.id);

describe('Files F2 #765 / #766 / #767: sort', () => {
  test('all 8 combinations: Name, Date, Size and Type, each ascending and descending', () => {
    const expected: Record<string, string[]> = {
      'name:asc': ['app', 'clip2', 'clip10', 'guide', 'song'],
      'name:desc': ['song', 'guide', 'clip10', 'clip2', 'app'],
      'date:asc': ['clip10', 'guide', 'song', 'clip2', 'app'],
      'date:desc': ['app', 'clip2', 'song', 'guide', 'clip10'],
      'size:asc': ['guide', 'clip2', 'song', 'app', 'clip10'],
      'size:desc': ['clip10', 'app', 'song', 'clip2', 'guide'],
      // The type tiles' order: video, audio, image, doc, archive, apk; the two videos keep their order (a tie).
      'type:asc': ['clip10', 'clip2', 'song', 'guide', 'app'],
      'type:desc': ['app', 'guide', 'song', 'clip10', 'clip2'],
    };
    let combinations = 0;
    for (const sortKey of FILES_SORT_KEYS) {
      for (const sortDirection of FILES_SORT_DIRECTIONS) {
        assert.deepEqual(order(FILES, { sortKey, sortDirection }), expected[`${sortKey}:${sortDirection}`], `${sortKey} ${sortDirection}`);
        combinations += 1;
      }
    }
    assert.equal(combinations, 8);
  });

  test('folders first on: the folders, then the files, each in the chosen order', () => {
    const rows = [...FILES, folder('Bfolder', 'B folder', '2026-06-01T00:00:00Z', 1000), folder('Afolder', 'A folder', null, 50)];
    assert.deepEqual(order(rows, { sortKey: 'name', sortDirection: 'asc', foldersFirst: true }), [
      'Afolder',
      'Bfolder',
      'app',
      'clip2',
      'clip10',
      'guide',
      'song',
    ]);
    assert.deepEqual(order(rows, { sortKey: 'size', sortDirection: 'desc', foldersFirst: true }), [
      'Bfolder',
      'Afolder',
      'clip10',
      'app',
      'song',
      'clip2',
      'guide',
    ]);
  });

  test('folders first off: folders mix with files in sort order', () => {
    const rows = [...FILES, folder('Bfolder', 'B folder', '2026-06-01T00:00:00Z', 1000), folder('Afolder', 'A folder', null, 50)];
    assert.deepEqual(order(rows, { sortKey: 'name', sortDirection: 'asc', foldersFirst: false }), [
      'Afolder',
      'app',
      'Bfolder',
      'clip2',
      'clip10',
      'guide',
      'song',
    ]);
    assert.deepEqual(order(rows, { sortKey: 'size', sortDirection: 'asc', foldersFirst: false }), [
      'Afolder',
      'guide',
      'clip2',
      'song',
      'app',
      'clip10',
      'Bfolder',
    ]);
    // Type: a folder comes before every file type.
    assert.deepEqual(order(rows, { sortKey: 'type', sortDirection: 'asc', foldersFirst: false }).slice(0, 2), ['Bfolder', 'Afolder']);
  });

  test('ties keep their order in both directions, and an unknown date always goes last', () => {
    const ties = [
      file('t1', 'same.mp4', '2026-01-01T00:00:00Z', 10, 'video'),
      file('t2', 'SAME.mp4', '2026-01-01T00:00:00Z', 10, 'video'),
      file('t3', 'same.mp4', null, 10, 'video'),
    ];
    for (const sortKey of FILES_SORT_KEYS) {
      for (const sortDirection of FILES_SORT_DIRECTIONS) {
        // Names, sizes and types all tie (case doesn't count); t3's date is unknown, so it is last by date too.
        assert.deepEqual(order(ties, { sortKey, sortDirection }), ['t1', 't2', 't3'], `${sortKey} ${sortDirection}`);
      }
    }
  });
});
