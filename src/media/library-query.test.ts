import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFAULT_LIBRARY_FILTERS,
  buildLibraryQuery,
  hasNarrowingFilters,
  libraryQueryFromKey,
  libraryQueryKey,
  normalizeSearch,
  scopeFromParam,
  titleMatches,
} from './library-query.ts';

describe('buildLibraryQuery', () => {
  test('default filters only carry the sort', () => {
    assert.deepEqual(buildLibraryQuery(DEFAULT_LIBRARY_FILTERS), { sort: 'newest' });
  });

  test('maps search, site and favorites scope', () => {
    assert.deepEqual(
      buildLibraryQuery({ search: '  cat   videos ', scope: 'favorites', site: 'tiktok', sort: 'largest' }),
      { sort: 'largest', search: 'cat videos', site: 'tiktok', favoritesOnly: true },
    );
  });

  test('blank search is omitted', () => {
    assert.deepEqual(buildLibraryQuery({ ...DEFAULT_LIBRARY_FILTERS, search: '   ' }), { sort: 'newest' });
  });
});

describe('query keys', () => {
  test('equal filters give equal keys regardless of whitespace', () => {
    const a = buildLibraryQuery({ ...DEFAULT_LIBRARY_FILTERS, search: 'dogs ' });
    const b = buildLibraryQuery({ ...DEFAULT_LIBRARY_FILTERS, search: ' dogs' });
    assert.equal(libraryQueryKey(a), libraryQueryKey(b));
    assert.notEqual(libraryQueryKey(a), libraryQueryKey({ ...a, sort: 'title' }));
  });

  test('a key decodes back to the same query', () => {
    const query = buildLibraryQuery({ search: 'x', scope: 'favorites', site: 'instagram', sort: 'longest' });
    assert.deepEqual(libraryQueryFromKey(libraryQueryKey(query)), query);
  });

  test('decoding rejects unknown sites and sorts', () => {
    assert.deepEqual(libraryQueryFromKey(JSON.stringify(['', 'myspace', false, 'random'])), { sort: 'newest' });
  });
});

test('normalizeSearch trims, collapses and caps length', () => {
  assert.equal(normalizeSearch('  a \n b  '), 'a b');
  assert.equal(normalizeSearch('x'.repeat(150)).length, 100);
});

test('scopeFromParam accepts only known scopes', () => {
  assert.equal(scopeFromParam('favorites'), 'favorites');
  assert.equal(scopeFromParam(['recent', 'all']), 'recent');
  assert.equal(scopeFromParam('everything'), null);
  assert.equal(scopeFromParam(undefined), null);
});

test('hasNarrowingFilters ignores sort', () => {
  assert.equal(hasNarrowingFilters({ ...DEFAULT_LIBRARY_FILTERS, sort: 'title' }), false);
  assert.equal(hasNarrowingFilters({ ...DEFAULT_LIBRARY_FILTERS, site: 'reddit' }), true);
  assert.equal(hasNarrowingFilters({ ...DEFAULT_LIBRARY_FILTERS, scope: 'recent' }), true);
  assert.equal(hasNarrowingFilters({ ...DEFAULT_LIBRARY_FILTERS, search: 'a' }), true);
});

test('titleMatches is case-insensitive and matches everything for a blank search', () => {
  assert.equal(titleMatches('Funny Cat Compilation', 'cat'), true);
  assert.equal(titleMatches('Funny Cat Compilation', 'dog'), false);
  assert.equal(titleMatches('Anything', '  '), true);
});
