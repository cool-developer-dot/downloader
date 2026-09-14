import type { StoreApi } from 'zustand';

import { writePersistedLibraryViewMode } from '@/library/view-mode';
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';

import { initialLibraryState } from './state';
import type { LibraryActions, LibraryStore } from './types';

type Set = StoreApi<LibraryStore>['setState'];

export function createLibraryActions(set: Set): LibraryActions {
  return {
    setSearchQuery: (query) => {
      set({ searchQuery: query });
    },
    setFilter: (filter) => {
      set((state) => ({
        filter,
        quality: filter === 'quality' ? state.quality : null,
        folderId:
          filter === 'folder' ? state.folderId ?? UNFILED_FOLDER_SELECTION_ID : null,
      }));
    },
    setSort: (sort) => {
      set({ sort });
    },
    setQuality: (quality) => {
      set({ quality });
    },
    setFolderId: (folderId) => {
      set({ folderId });
    },
    setViewMode: (mode) => {
      writePersistedLibraryViewMode(mode);
      set({ viewMode: mode });
    },
    setAvailability: (availabilityById) => {
      set({ availabilityById });
    },
    patchAvailability: (id, availability) => {
      set((state) => ({
        availabilityById: {
          ...state.availabilityById,
          [id]: availability,
        },
      }));
    },
    bumpSourceRevision: () => {
      set((state) => ({ sourceRevision: state.sourceRevision + 1 }));
    },
    setLoading: (loading) => {
      set({ loading });
    },
    setRefreshing: (refreshing) => {
      set({ refreshing });
    },
    setError: (error) => {
      set({ error });
    },
    markReconciled: (at) => {
      set({ lastReconciledAt: at });
    },
    markInitialized: () => {
      set({ initialized: true });
    },
    resetQuery: () => {
      set({
        searchQuery: '',
        filter: initialLibraryState.filter,
        sort: initialLibraryState.sort,
        quality: null,
        folderId: null,
      });
    },
    reset: () => {
      set({
        ...initialLibraryState,
        viewMode: initialLibraryState.viewMode,
      });
    },
  };
}
