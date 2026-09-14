import type { BookmarksState } from './types';

export const selectBookmarkItems = (state: BookmarksState) => state.items;
export const selectBookmarksLoading = (state: BookmarksState) => state.loading;
export const selectBookmarksLoadingMore = (state: BookmarksState) => state.loadingMore;
export const selectBookmarksRefreshing = (state: BookmarksState) => state.refreshing;
export const selectBookmarksSyncing = (state: BookmarksState) => state.syncing;
export const selectBookmarksSaving = (state: BookmarksState) => state.saving;
export const selectBookmarksError = (state: BookmarksState) => state.error;
export const selectBookmarksHasMore = (state: BookmarksState) => state.hasMore;
export const selectBookmarksQuery = (state: BookmarksState) => state.query;
export const selectBookmarksTotal = (state: BookmarksState) => state.total;
export const selectBookmarksReady = (state: BookmarksState) => state.ready;
export const selectBookmarksInitialized = (state: BookmarksState) => state.initialized;
export const selectBookmarksLastSync = (state: BookmarksState) => state.lastSync;
export const selectBookmarksUrlIndex = (state: BookmarksState) => state.urlIndex;
export const selectBookmarksPendingUrls = (state: BookmarksState) => state.pendingUrls;
