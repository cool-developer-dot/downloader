import { bookmarkService, historyService, recentSearchService } from '@/storage/services';

import type { SuggestionSources } from './suggestion.service';

/** The suggestion index's sources in the app: the local history, bookmark and recent-search stores. */
export const storageSuggestionSources: SuggestionSources = {
  async listHistory(limit) {
    const page = await historyService.list({
      page: 1,
      pageSize: limit,
      sortBy: 'visitedAt',
      sortDirection: 'desc',
    });
    return page.items;
  },
  async listBookmarks(limit) {
    const page = await bookmarkService.list({
      page: 1,
      pageSize: limit,
      sortBy: 'updatedAt',
      sortDirection: 'desc',
    });
    return page.items;
  },
  listFrequentlyVisited(limit) {
    return historyService.getFrequentlyVisited(limit);
  },
  async listRecentSearches(limit) {
    const page = await recentSearchService.list({
      page: 1,
      pageSize: limit,
      sortBy: 'searchedAt',
      sortDirection: 'desc',
    });
    return page.items.map((item) => ({
      id: item.id,
      query: item.query,
      searchedAt: item.searchedAt,
    }));
  },
};
