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

describe('address bar suggestions switch (B5 #61)', () => {
  beforeEach(() => {
    suggestionCache.invalidate();
  });

  it('off: no history, bookmark, frequent, site or recent-search rows; the typed search stays', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);
    const on = await service.getSuggestions('cat');
    assert.ok(on.some((r) => r.kind === 'recent_search' || r.kind === 'history' || r.kind === 'frequent'));
    const off = await service.getSuggestions('cat', {
      include: { history: false, bookmarks: false, recentSearches: false },
    });
    assert.deepEqual(kinds(off), ['search']);
    // The empty field shows nothing at all.
    assert.deepEqual(
      await service.getSuggestions('', { include: { history: false, bookmarks: false, recentSearches: false } }),
      [],
    );
  });

  it('history off alone keeps bookmarks (B10 #101 uses this)', async () => {
    const stores = createStores();
    const bookmarkSources: SuggestionSources = {
      ...stores.sources,
      listBookmarks: async () => [
        {
          id: 'b1',
          url: 'https://cats.example/',
          title: 'Cat bookmark',
          hostname: 'cats.example',
          faviconUrl: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    };
    const service = new SuggestionService(bookmarkSources);
    const results = await service.getSuggestions('cat', { include: { history: false } });
    assert.ok(results.some((r) => r.kind === 'bookmark'));
    assert.ok(!results.some((r) => r.kind === 'history' || r.kind === 'frequent'));
  });

  it('the search row names the chosen engine', async () => {
    const stores = createStores();
    const service = new SuggestionService(stores.sources);
    const results = await service.getSuggestions('lahore');
    const search = results.find((r) => r.kind === 'search');
    assert.ok(search);
    assert.match(search!.title, /Google/);
    assert.equal(search!.hostname, 'www.google.com');
  });
});

describe('address bar calculator and autocomplete sources (B4)', () => {
  beforeEach(() => {
    suggestionCache.invalidate();
  });

  it('an expression puts its result first; nothing for an unfinished one', async () => {
    const service = new SuggestionService(createStores().sources);
    for (const [query, title] of [
      ['12*(3+4)/2', '= 42'],
      ['15% of 2000', '= 300'],
      ['2^10', '= 1024'],
      ['۱۲+۳', '= 15'],
    ] as const) {
      const results = await service.getSuggestions(query);
      assert.equal(results[0]?.kind, 'calculator', `${query}: ${JSON.stringify(kinds(results))}`);
      assert.equal(results[0]?.title, title);
    }
    for (const query of ['12*', '5/0', '42', 'cats']) {
      const results = await service.getSuggestions(query);
      assert.ok(!results.some((r) => r.kind === 'calculator'), query);
    }
  });

  it('the calculator stays when local suggestions are off (it reads no history)', async () => {
    const service = new SuggestionService(createStores().sources);
    const results = await service.getSuggestions('7*6', {
      include: { history: false, bookmarks: false, recentSearches: false },
    });
    assert.deepEqual(kinds(results), ['calculator', 'search']);
  });

  it('autocomplete sources: history and frequent hosts, bookmarks flagged, each source switchable', async () => {
    const stores = createStores();
    const service = new SuggestionService({
      ...stores.sources,
      listBookmarks: async () => [
        {
          id: 'b1',
          url: 'https://www.bbc.com/news',
          title: 'BBC',
          hostname: 'www.bbc.com',
          faviconUrl: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const all = await service.getAutocompleteSources();
    assert.ok(all.some((s) => s.host === 'www.catster.com' && !s.bookmarked));
    assert.ok(all.some((s) => s.host === 'www.bbc.com' && s.bookmarked));
    const noHistory = await service.getAutocompleteSources({ history: false });
    assert.deepEqual(noHistory.map((s) => s.host), ['www.bbc.com']);
  });
});
