import type { StoreApi } from 'zustand';

import { isApiError } from '@/api';
import { historyService } from '@/storage/services';
import { isStorageError } from '@/storage/types';

import { initialHistoryState } from './state';
import { reducePrependVisit } from './visit-reducer';
import type { HistoryActions, HistoryStore } from './types';

function getErrorMessage(error: unknown, fallback: string): string {
  if (isStorageError(error)) {
    return error.message;
  }

  if (isApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function createHistoryActions(
  set: StoreApi<HistoryStore>['setState'],
  get: StoreApi<HistoryStore>['getState'],
): HistoryActions {
  let loadRequestId = 0;
  let loadMoreInFlight = false;

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
        initialized: true,
        loading: false,
        loadingMore: false,
        refreshing: false,
        error: null,
      }));
    },
    prependOrUpdate: (entry) => {
      set((state) => reducePrependVisit(state, entry));
    },
    load: async (page = 1, options = {}) => {
      const state = get();
      const requestId = ++loadRequestId;
      const isFirstPage = page === 1;
      const hasKnownState = state.initialized || state.items.length > 0;

      set({
        loading: isFirstPage && !hasKnownState,
        refreshing: isFirstPage && hasKnownState,
        loadingMore: !isFirstPage,
        error: null,
      });

      try {
        const listOptions = {
          page,
          pageSize: state.pageSize,
          query: state.query || undefined,
          sortBy: state.sortBy,
          sortDirection: state.sortDirection,
        };

        if (isFirstPage) {
          const local = await historyService.list(listOptions);

          if (requestId !== loadRequestId) {
            return;
          }

          get().applyPage(local, false);
          set({
            lastSync: new Date().toISOString(),
            syncing: false,
            refreshing: false,
          });
          return;
        }

        const result = await historyService.list(listOptions);

        if (requestId !== loadRequestId) {
          return;
        }

        get().applyPage(result, true);
      } catch (error) {
        if (requestId !== loadRequestId) {
          return;
        }

        set({
          loading: false,
          loadingMore: false,
          refreshing: false,
          syncing: false,
          error: getErrorMessage(error, 'Failed to load history'),
          initialized: true,
        });
      }
    },
    refresh: async () => {
      await get().load(1, { forceRemote: true });
    },
    loadMore: async () => {
      const state = get();

      if (!state.hasMore || state.loading || state.loadingMore || state.refreshing) {
        return;
      }

      if (loadMoreInFlight) {
        return;
      }

      loadMoreInFlight = true;

      try {
        await get().load(state.page + 1);
      } finally {
        loadMoreInFlight = false;
      }
    },
    search: async (query) => {
      set({ query, page: 1 });
      await get().load(1, { forceRemote: true });
    },
    addVisit: async (input) => {
      try {
        const entry = await historyService.recordVisit(input);
        get().prependOrUpdate(entry);
        return entry;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to record visit') });
        return null;
      }
    },
    remove: async (id) => {
      try {
        const deleted = await historyService.remove(id);

        if (deleted) {
          set((state) => ({
            items: state.items.filter((item) => item.id !== id),
            total: Math.max(0, state.total - 1),
          }));
        }

        return deleted;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to delete history entry') });
        return false;
      }
    },
    clear: async () => {
      try {
        await historyService.clear();
        set({
          ...initialHistoryState,
          ready: true,
          initialized: true,
        });
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to clear history') });
        return false;
      }
    },
    reset: () => {
      loadRequestId += 1;
      loadMoreInFlight = false;
      set(initialHistoryState);
    },
  };
}
