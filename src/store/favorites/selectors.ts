import type { FavoritesState } from './types';

export const selectFavoriteOrderedIds = (state: FavoritesState) => state.orderedIds;
export const selectFavoriteItemsById = (state: FavoritesState) => state.itemsById;
export const selectFavoritesTotal = (state: FavoritesState) => state.total;
export const selectFavoritesLoading = (state: FavoritesState) => state.loading;
export const selectFavoritesLoadingMore = (state: FavoritesState) => state.loadingMore;
export const selectFavoritesRefreshing = (state: FavoritesState) => state.refreshing;
export const selectFavoritesSaving = (state: FavoritesState) => state.saving;
export const selectFavoritesError = (state: FavoritesState) => state.error;
export const selectFavoritesHasMore = (state: FavoritesState) => state.hasMore;
export const selectFavoritesQuery = (state: FavoritesState) => state.query;
export const selectFavoritesSort = (state: FavoritesState) => state.sort;
export const selectFavoritesReady = (state: FavoritesState) => state.ready;
export const selectFavoritesInitialized = (state: FavoritesState) => state.initialized;
export const selectFavoritesUrlIndex = (state: FavoritesState) => state.urlIndex;
export const selectFavoritesPendingUrls = (state: FavoritesState) => state.pendingUrls;
export const selectFavoritesMutatingIds = (state: FavoritesState) => state.mutatingIds;

export const selectFavoriteById = (id: string) => (state: FavoritesState) =>
  state.itemsById[id];

export const selectIsFavoriteMutating = (id: string) => (state: FavoritesState) =>
  Boolean(state.mutatingIds[id]);
