import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { UNFILED_FOLDER_SELECTION_ID } from './constants.ts';
import {
  DURATION_BUCKETS,
  durationBucketOf,
  filterByDurationBucket,
  isDurationBucket,
  itemDurationSeconds,
  matchesDurationBucket,
} from './duration-buckets.ts';
import {
  applyFolderExclusion,
  countExcluded,
  folderKeyOf,
  normalizeExcludedFolderIds,
  setFolderExcluded,
} from './folder-exclusion.ts';
import { applyLibraryQuery, sortLibraryItems } from './query.ts';
import { LIBRARY_SORTS, type LibraryQueryInput, type MediaLibraryItem } from './types.ts';

/** P9 #711 duration buckets, #628 hidden folders and #626 Most played, alone and through the Library's query. */

function item(id: string, patch: Partial<MediaLibraryItem> = {}): MediaLibraryItem {
  return {
    id,
    downloadId: id,
    displayName: id,
    fileName: `${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: '1000',
    quality: null,
    resolution: null,
    bitrate: null,
    duration: null,
    downloadedAt: '2026-11-01T00:00:00.000Z',
    favorite: false,
    folderId: null,
    folderName: null,
    localAvailability: 'available',
    thumbnailUri: null,
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
    ...patch,
  };
}

const QUERY: LibraryQueryInput = {
  search: '',
  filter: 'all',
  sort: 'newest',
  quality: null,
  folderId: null,
  recentDownloadWindowMs: 7 * 24 * 3600 * 1000,
  nowMs: Date.parse('2026-11-23T00:00:00.000Z'),
};

const ids = (items: readonly MediaLibraryItem[]) => items.map((entry) => entry.id);

describe('P9 #711 duration buckets', () => {
  test('the five choices, Any first', () => {
    assert.deepEqual([...DURATION_BUCKETS], ['any', 'under5', 'from5to20', 'from20to60', 'over60']);
    assert.ok(isDurationBucket('over60'));
    assert.ok(!isDurationBucket('long'));
  });

  test('boundaries: exactly 5:00, 20:00 and 60:00 start the next bucket; the length is floored to whole seconds', () => {
    assert.equal(durationBucketOf(1), 'under5');
    assert.equal(durationBucketOf(299), 'under5');
    assert.equal(durationBucketOf(299.9), 'under5', '4:59.9 shows as 4:59');
    assert.equal(durationBucketOf(300), 'from5to20', 'exactly 5:00');
    assert.equal(durationBucketOf(1199.99), 'from5to20');
    assert.equal(durationBucketOf(1200), 'from20to60', 'exactly 20:00');
    assert.equal(durationBucketOf(3599.5), 'from20to60');
    assert.equal(durationBucketOf(3600), 'over60', 'exactly 60:00');
    assert.equal(durationBucketOf(4 * 3600), 'over60');
  });

  test('an unknown length (null, 0, negative, NaN) is in no bucket and shows only under Any', () => {
    for (const unknown of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(durationBucketOf(unknown), null, String(unknown));
      assert.equal(matchesDurationBucket(unknown, 'any'), true);
      for (const bucket of DURATION_BUCKETS.filter((b) => b !== 'any')) {
        assert.equal(matchesDurationBucket(unknown, bucket), false, `${String(unknown)} ${bucket}`);
      }
    }
  });

  test('an item’s own length wins; otherwise the length known elsewhere (native library, playback)', () => {
    assert.equal(itemDurationSeconds(item('a', { duration: 42 }), { a: 999 }), 42);
    assert.equal(itemDurationSeconds(item('a'), { a: 999 }), 999);
    assert.equal(itemDurationSeconds(item('a'), {}), null);
    const items = [item('short', { duration: 60 }), item('mid'), item('unknown')];
    assert.deepEqual(ids(filterByDurationBucket(items, 'from5to20', { mid: 600 })), ['mid']);
    assert.deepEqual(ids(filterByDurationBucket(items, 'under5', { mid: 600 })), ['short']);
    assert.deepEqual(ids(filterByDurationBucket(items, 'any', {})), ['short', 'mid', 'unknown']);
    assert.deepEqual(ids(filterByDurationBucket(items, undefined)), ['short', 'mid', 'unknown']);
  });
});

describe('P9 #628 hidden folders', () => {
  const library = [
    item('loose'),
    item('cook1', { folderId: 'cooking' }),
    item('cook2', { folderId: 'cooking' }),
    item('drama', { folderId: 'drama' }),
  ];

  test('a video in no folder is "Unfiled / Downloads"', () => {
    assert.equal(folderKeyOf(item('x')), UNFILED_FOLDER_SELECTION_ID);
    assert.equal(folderKeyOf(item('x', { folderId: 'f' })), 'f');
  });

  test('hide and show folders; the stored list is read back tolerantly', () => {
    let hidden = setFolderExcluded([], 'cooking', true);
    hidden = setFolderExcluded(hidden, UNFILED_FOLDER_SELECTION_ID, true);
    hidden = setFolderExcluded(hidden, 'cooking', true);
    assert.deepEqual(hidden, ['cooking', UNFILED_FOLDER_SELECTION_ID]);
    assert.deepEqual(setFolderExcluded(hidden, 'cooking', false), [UNFILED_FOLDER_SELECTION_ID]);
    assert.deepEqual(normalizeExcludedFolderIds(['a', 'a', '', 3, null, ' ', 'b']), ['a', 'b']);
    assert.deepEqual(normalizeExcludedFolderIds('not a list'), []);
  });

  test('hidden folders leave their videos out; the Folder filter naming one still shows it', () => {
    assert.deepEqual(ids(applyFolderExclusion(library, ['cooking'])), ['loose', 'drama']);
    assert.deepEqual(ids(applyFolderExclusion(library, [UNFILED_FOLDER_SELECTION_ID, 'drama'])), ['cook1', 'cook2']);
    assert.deepEqual(ids(applyFolderExclusion(library, [])), ids(library));
    assert.deepEqual(
      ids(applyFolderExclusion(library, ['cooking', 'drama'], { filter: 'folder', folderId: 'cooking' })),
      ['loose', 'cook1', 'cook2'],
    );
    assert.equal(countExcluded(library, ['cooking']), 2);
    assert.equal(countExcluded(library, []), 0);
  });

  test('through the Library query: hidden from the list, from search and from Most played; nothing else changes', () => {
    const query = { ...QUERY, excludedFolderIds: ['cooking'] };
    assert.deepEqual(ids(applyLibraryQuery(library, query).items).sort(), ['drama', 'loose']);
    assert.deepEqual(ids(applyLibraryQuery(library, { ...query, search: 'cook' }).items), []);
    const playCounts = { cook1: { playCount: 9, lastPlayedAt: null }, drama: { playCount: 1, lastPlayedAt: null } };
    assert.deepEqual(ids(applyLibraryQuery(library, { ...query, sort: 'most_played', playCounts }).items), ['drama', 'loose']);
    assert.deepEqual(
      ids(applyLibraryQuery(library, { ...query, filter: 'folder', folderId: 'cooking' }).items).sort(),
      ['cook1', 'cook2'],
    );
    // The source is never changed (no file or folder assignment moves).
    assert.equal(library[1]!.folderId, 'cooking');
    assert.equal(applyLibraryQuery(library, query).playableCount, 4);
  });
});

describe('P9 #626 Most played', () => {
  test('is a Library sort, after the ones before it', () => {
    assert.equal(LIBRARY_SORTS[LIBRARY_SORTS.length - 1], 'most_played');
    assert.ok(LIBRARY_SORTS.includes('recently_played'));
  });

  test('play count first; ties by the last counted play, then last played, then newest; never played last', () => {
    const items = [
      item('never-new', { downloadedAt: '2026-11-20T00:00:00.000Z' }),
      item('once-old'),
      item('three'),
      item('once-recent'),
      item('never-old', { downloadedAt: '2026-10-01T00:00:00.000Z' }),
      item('once-uncounted-time', { lastPlayedAt: '2026-11-22T00:00:00.000Z' }),
    ];
    const playCounts = {
      three: { playCount: 3, lastPlayedAt: '2026-11-01T00:00:00.000Z' },
      'once-old': { playCount: 1, lastPlayedAt: '2026-11-02T00:00:00.000Z' },
      'once-recent': { playCount: 1, lastPlayedAt: '2026-11-21T00:00:00.000Z' },
      'once-uncounted-time': { playCount: 1, lastPlayedAt: null },
    };
    assert.deepEqual(ids(sortLibraryItems(items, 'most_played', playCounts)), [
      'three',
      'once-recent',
      'once-old',
      'once-uncounted-time',
      'never-new',
      'never-old',
    ]);
  });

  test('without play counts every video is "never played" (newest first); other sorts ignore the counts', () => {
    const items = [item('a', { downloadedAt: '2026-11-01T00:00:00.000Z' }), item('b', { downloadedAt: '2026-11-05T00:00:00.000Z' })];
    assert.deepEqual(ids(sortLibraryItems(items, 'most_played')), ['b', 'a']);
    assert.deepEqual(
      ids(sortLibraryItems(items, 'oldest', { b: { playCount: 50, lastPlayedAt: null } })),
      ['a', 'b'],
    );
  });

  test('combines with filters, the length filter and search', () => {
    const items = [
      item('fav-long', { favorite: true, duration: 4000 }),
      item('fav-short', { favorite: true, duration: 100 }),
      item('fav-unknown', { favorite: true }),
      item('plain-short', { duration: 120 }),
    ];
    const playCounts = { 'fav-short': { playCount: 2, lastPlayedAt: null }, 'plain-short': { playCount: 5, lastPlayedAt: null } };
    const result = applyLibraryQuery(items, {
      ...QUERY,
      filter: 'favorites',
      sort: 'most_played',
      durationBucket: 'under5',
      playCounts,
    });
    assert.deepEqual(ids(result.items), ['fav-short']);
    assert.deepEqual(
      ids(applyLibraryQuery(items, { ...QUERY, sort: 'most_played', durationBucket: 'under5', playCounts }).items),
      ['plain-short', 'fav-short'],
    );
    assert.deepEqual(
      ids(applyLibraryQuery(items, { ...QUERY, durationBucket: 'over60', durationById: { 'fav-unknown': 3600 } }).items).sort(),
      ['fav-long', 'fav-unknown'],
    );
    assert.deepEqual(
      ids(applyLibraryQuery(items, { ...QUERY, search: 'plain', durationBucket: 'under5' }).items),
      ['plain-short'],
    );
  });

  test('without the P9 fields the query is exactly as before', () => {
    const items = [item('a', { folderId: 'x' }), item('b', { duration: 9999 })];
    assert.deepEqual(ids(applyLibraryQuery(items, QUERY).items), ids(sortLibraryItems(items, 'newest')));
    assert.equal(applyLibraryQuery(items, QUERY).items.length, 2);
  });
});
