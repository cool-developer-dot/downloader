import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { hasFilters, searchFiles, type SearchItem } from './files-search';
import { searchStateFromParams } from './search-params';

const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 10, 26);

const item = (id: string, sizeBytes: number): SearchItem => ({
  id,
  name: `${id}.mp4`,
  type: 'video',
  sizeBytes,
  date: new Date(NOW).toISOString(),
  folderId: null,
});

describe('Files F9: the search opened from the Storage page', () => {
  test('a link sets the types, "> 100 MB", Old and the sort; anything unknown is ignored', () => {
    assert.deepEqual(searchStateFromParams({ types: 'archive,apk', sort: 'size' }), {
      filters: { types: ['archive', 'apk'] },
      sort: 'size',
    });
    assert.deepEqual(searchStateFromParams({ minMb: '100', old: '6' }), {
      filters: { minBytes: 100 * MB, oldMonths: 6 },
      sort: null,
    });
    assert.deepEqual(searchStateFromParams({ types: 'video,nope', minMb: '-5', old: '5', sort: 'loudest' }), {
      filters: { types: ['video'] },
      sort: null,
    });
    assert.deepEqual(searchStateFromParams({}), { filters: {}, sort: null });
  });

  test('"> 100 MB" keeps only files over 100 MB, and counts as a filter', () => {
    const items = [item('small', 100 * MB), item('big', 100 * MB + 1), item('huge', 2048 * MB)];
    const ids = searchFiles(items, { query: '', filters: { minBytes: 100 * MB }, sort: 'size', now: NOW }).map((hit) => hit.item.id);
    assert.deepEqual(ids, ['huge', 'big']);
    assert.equal(hasFilters({ minBytes: 100 * MB }), true);
    assert.equal(hasFilters({}), false);
  });
});
