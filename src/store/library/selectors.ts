import type { LibraryStore } from './types';

export const selectLibrarySearchQuery = (state: LibraryStore) => state.searchQuery;
export const selectLibraryFilter = (state: LibraryStore) => state.filter;
export const selectLibrarySort = (state: LibraryStore) => state.sort;
export const selectLibraryQuality = (state: LibraryStore) => state.quality;
export const selectLibraryFolderId = (state: LibraryStore) => state.folderId;
export const selectLibraryViewMode = (state: LibraryStore) => state.viewMode;
export const selectLibraryAvailabilityById = (state: LibraryStore) =>
  state.availabilityById;
export const selectLibraryLoading = (state: LibraryStore) => state.loading;
export const selectLibraryRefreshing = (state: LibraryStore) => state.refreshing;
export const selectLibraryError = (state: LibraryStore) => state.error;
export const selectLibraryInitialized = (state: LibraryStore) => state.initialized;
export const selectLibraryLastReconciledAt = (state: LibraryStore) =>
  state.lastReconciledAt;
