import type { StoreApi } from 'zustand';

import { recentSearchService } from '@/storage/services';
import { isStorageError } from '@/storage/types';

import { initialRecentSearchesState } from './state';
import type { RecentSearchesActions, RecentSearchesStore } from './types';

function getErrorMessage(error: unknown, fallback: string): string {
  if (isStorageError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function createRecentSearchesActions(
  set: StoreApi<RecentSearchesStore>['setState'],
  get: StoreApi<RecentSearchesStore>['getState'],
): RecentSearchesActions {
  return {
    setQuery: (query) => {
      set({ query });
    },
    setSort: (sortBy, sortDirection = 'desc') => {
      set({ sortBy, sortDirection });
    },
    applyPage: (result, append = false) => {
      set((state) => ({
        items: append ? [...state.items, ...result.items] : result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
        ready: true,
        loading: false,
        refreshing: false,
        error: null,
      }));
    },
    load: async (page = 1) => {
      const state = get();

      set({
        loading: page === 1 && state.items.length === 0,
        refreshing: page === 1 && state.items.length > 0,
        error: null,
      });

      try {
        const result = await recentSearchService.list({
          page,
          pageSize: state.pageSize,
          query: state.query || undefined,
          sortBy: state.sortBy,
          sortDirection: state.sortDirection,
        });

        get().applyPage(result, page > 1);
      } catch (error) {
        set({
          loading: false,
          refreshing: false,
          error: getErrorMessage(error, 'Failed to load recent searches'),
        });
      }
    },
    refresh: async () => {
      await get().load(1);
    },
    loadMore: async () => {
      const state = get();

      if (!state.hasMore || state.loading || state.refreshing) {
        return;
      }

      await get().load(state.page + 1);
    },
    search: async (query) => {
      set({ query, page: 1 });
      await get().load(1);
    },
    record: async (query) => {
      try {
        const entry = await recentSearchService.record({ query });
        await get().refresh();
        void import('@/browser/suggestions').then(({ suggestionService }) => {
          suggestionService.invalidate();
        });
        return entry;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to record search') });
        return null;
      }
    },
    remove: async (id) => {
      try {
        const deleted = await recentSearchService.remove(id);

        if (deleted) {
          set((state) => ({
            items: state.items.filter((item) => item.id !== id),
            total: Math.max(0, state.total - 1),
          }));
        }

        return deleted;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to delete recent search') });
        return false;
      }
    },
    clear: async () => {
      try {
        await recentSearchService.clear();
        set({
          ...initialRecentSearchesState,
          ready: true,
        });
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to clear recent searches') });
        return false;
      }
    },
    reset: () => {
      set(initialRecentSearchesState);
    },
  };
}
