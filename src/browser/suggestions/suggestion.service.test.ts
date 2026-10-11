import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import type { BrowserHistoryEntry } from '@/storage/types';

import { clearRecentSearches } from '../../store/recent-searches/clear-recent-searches.ts';
import { suggestionCache } from './suggestion.cache.ts';
import { SuggestionService, type SuggestionSources } from './suggestion.service.ts';

const NOW = '2026-10-10T08:00:00.000Z';

/** In-memory stand-ins for the history and recent-search tables. */
function createStores() {
  const history: BrowserHistoryEntry[] = [
    {
      id: 'h1',
      url: 'https://www.catster.com/guides/',
      title: 'Catster guides',
      hostname: 'www.catster.com',
      visitedAt: NOW,
      createdAt: NOW,
    },
  ];
  let searches = [{ id: 's1', query: 'cats', searchedAt: NOW }];
  const sources: SuggestionSources = {
    listHistory: async (limit) => history.slice(0, limit),
    listBookmarks: async () => [],
    listFrequentlyVisited: async () => history.map((entry) => ({ ...entry, visitCount: 1 })),
    listRecentSearches: async (limit) => searches.slice(0, limit),
  };
  return {
    history,
    sources,
    searchCount: () => searches.length,
    clearSearches: async () => {
      const removed = searches.length;
      searches = [];
      return removed;
    },
  };
}

function kinds(results: { kind: string }[]): string[] {
  return results.map((result) => result.kind);
}

describe('clearing recent searches', () => {
  beforeEach(() => {
    suggestionCache.invalidate();
  });

  it('suggests a recent search before it is cleared', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);

    const results = await service.getSuggestions('ca');

    assert.ok(
      results.some((result) => result.kind === 'recent_search' && result.title === 'cats'),
      `expected "cats" among ${JSON.stringify(kinds(results))}`,
    );
  });

  it('offers no recent_search item after clear, even for a query typed before', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);
    await service.getSuggestions('ca'); // index and per-query cache now hold "cats"

    const removed = await clearRecentSearches({
      clearStored: stores.clearSearches,
      invalidateSuggestions: () => service.invalidate(),
    });

    assert.equal(removed, 1);
    assert.equal(stores.searchCount(), 0);
    for (const query of ['ca', 'cats', 'c']) {
      const results = await service.getSuggestions(query);
      assert.deepEqual(
        results.filter((result) => result.kind === 'recent_search'),
        [],
        `query "${query}"`,
      );
    }
  });

  it('keeps browsing history suggestions', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);

    await clearRecentSearches({
      clearStored: stores.clearSearches,
      invalidateSuggestions: () => service.invalidate(),
    });

    assert.equal(stores.history.length, 1);
    const results = await service.getSuggestions('catster');
    assert.ok(
      results.some((result) => result.url === 'https://www.catster.com/guides/'),
      `expected the history page among ${JSON.stringify(kinds(results))}`,
    );
  });

  it('would keep offering the search without the invalidation (the cached index is the trap)', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);
    await service.getSuggestions('ca');

    await stores.clearSearches(); // storage cleared, index not told

    const results = await service.getSuggestions('ca');
    assert.ok(results.some((result) => result.kind === 'recent_search'));
  });
});
