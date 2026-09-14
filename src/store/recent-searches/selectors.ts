import type { RecentSearchesState } from './types';

export const selectRecentSearchItems = (state: RecentSearchesState) => state.items;
export const selectRecentSearchesLoading = (state: RecentSearchesState) => state.loading;
export const selectRecentSearchesError = (state: RecentSearchesState) => state.error;
export const selectRecentSearchesHasMore = (state: RecentSearchesState) => state.hasMore;
export const selectRecentSearchesQuery = (state: RecentSearchesState) => state.query;
export const selectRecentSearchesTotal = (state: RecentSearchesState) => state.total;
