import type { StoreApi } from 'zustand';

import { isApiError } from '@/api';
import { bookmarkService } from '@/storage/services';
import { isStorageError, type BookmarkEntry } from '@/storage/types';
import { normalizeUrl } from '@/storage/utils';

import { initialBookmarksState } from './state';
import type { BookmarksActions, BookmarksStore } from './types';

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

function normalizeKey(url: string): string {
  return normalizeUrl(url).trim().toLowerCase();
}

function buildUrlIndex(items: BookmarkEntry[]): Record<string, string> {
  const index: Record<string, string> = {};
  for (const item of items) {
    index[normalizeKey(item.url)] = item.id;
  }
  return index;
}

function mergeBookmarkIntoItems(
  items: BookmarkEntry[],
  entry: BookmarkEntry,
): BookmarkEntry[] {
  const withoutSame = items.filter(
    (item) => item.id !== entry.id && normalizeKey(item.url) !== normalizeKey(entry.url),
  );
  return [entry, ...withoutSame];
}

export function createBookmarksActions(
  set: StoreApi<BookmarksStore>['setState'],
  get: StoreApi<BookmarksStore>['getState'],
): BookmarksActions {
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
      set((state) => {
        const items = append ? [...state.items, ...result.items] : result.items;
        return {
          items,
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
          urlIndex: buildUrlIndex(items),
        };
      });
    },
    prependOrUpdate: (entry) => {
      set((state) => {
        const existed = state.items.some(
          (item) =>
            item.id === entry.id || normalizeKey(item.url) === normalizeKey(entry.url),
        );
        const items = mergeBookmarkIntoItems(state.items, entry);

        return {
          items,
          total: existed ? state.total : state.total + 1,
          ready: true,
          initialized: true,
          error: null,
          urlIndex: buildUrlIndex(items),
        };
      });
    },
    isUrlBookmarked: (url) => {
      const key = normalizeKey(url);
      return Boolean(get().urlIndex[key]);
    },
    resolveBookmarkForUrl: async (url) => {
      const key = normalizeKey(url);
      const state = get();
      const id = state.urlIndex[key];

      if (id) {
        const cached = state.items.find((item) => item.id === id);
        if (cached) {
          return cached;
        }
      }

      const entry = await bookmarkService.getByUrl(url);

      if (entry) {
        set((current) => ({
          urlIndex: { ...current.urlIndex, [normalizeKey(entry.url)]: entry.id },
        }));
      }

      return entry;
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
          const local = await bookmarkService.list(listOptions);

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

        const result = await bookmarkService.list(listOptions);

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
          error: getErrorMessage(error, 'Failed to load bookmarks'),
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
    add: async (input) => {
      set({ saving: true, error: null });
      try {
        const bookmark = await bookmarkService.add(input);
        get().prependOrUpdate(bookmark);
        set({ saving: false });
        return bookmark;
      } catch (error) {
        set({
          saving: false,
          error: getErrorMessage(error, 'Failed to add bookmark'),
        });
        return null;
      }
    },
    update: async (id, input) => {
      try {
        const bookmark = await bookmarkService.update(id, input);
        set((state) => {
          const items = state.items.map((item) => (item.id === id ? bookmark : item));
          return {
            items,
            urlIndex: buildUrlIndex(items),
          };
        });
        return bookmark;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to update bookmark') });
        return null;
      }
    },
    remove: async (id) => {
      try {
        const deleted = await bookmarkService.remove(id);

        if (deleted) {
          set((state) => {
            const items = state.items.filter((item) => item.id !== id);
            return {
              items,
              total: Math.max(0, state.total - 1),
              urlIndex: buildUrlIndex(items),
            };
          });
        }

        return deleted;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to delete bookmark') });
        return false;
      }
    },
    removeByUrl: async (url) => {
      try {
        const deleted = await bookmarkService.removeByUrl(url);

        if (deleted) {
          const key = normalizeKey(url);
          set((state) => {
            const items = state.items.filter(
              (item) => normalizeKey(item.url) !== key,
            );
            return {
              items,
              total: Math.max(0, state.total - 1),
              urlIndex: buildUrlIndex(items),
            };
          });
        }

        return deleted;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to delete bookmark') });
        return false;
      }
    },
    toggle: async (input) => {
      set({ saving: true, error: null });
      try {
        const result = await bookmarkService.toggle(input);

        if (result.bookmarked && result.bookmark) {
          get().prependOrUpdate(result.bookmark);
        } else {
          const key = normalizeKey(input.url);
          set((state) => {
            const items = state.items.filter(
              (item) => normalizeKey(item.url) !== key,
            );
            return {
              items,
              total: Math.max(0, state.total - 1),
              urlIndex: buildUrlIndex(items),
            };
          });
        }

        set({ saving: false });
        return result;
      } catch (error) {
        set({
          saving: false,
          error: getErrorMessage(error, 'Failed to toggle bookmark'),
        });
        return { bookmarked: false, bookmark: null };
      }
    },
    toggleOptimistic: async (input) => {
      const key = normalizeKey(input.url);
      const state = get();

      if (state.pendingUrls[key]) {
        return {
          bookmarked: Boolean(state.urlIndex[key]),
          bookmark: state.items.find((item) => normalizeKey(item.url) === key) ?? null,
        };
      }

      const wasBookmarked = Boolean(state.urlIndex[key]);
      const previousItems = state.items;
      const previousTotal = state.total;
      const previousIndex = state.urlIndex;
      const existingId = state.urlIndex[key];

      set({
        pendingUrls: { ...state.pendingUrls, [key]: true },
        saving: true,
        error: null,
      });

      if (wasBookmarked) {
        set((current) => {
          const items = current.items.filter(
            (item) => normalizeKey(item.url) !== key,
          );
          const urlIndex = { ...current.urlIndex };
          delete urlIndex[key];
          return {
            items,
            total: Math.max(0, current.total - 1),
            urlIndex,
          };
        });
      } else {
        const optimistic: BookmarkEntry = {
          id: `optimistic-${Date.now()}`,
          url: input.url,
          title: input.title?.trim() || input.url,
          hostname: input.hostname?.trim() || '',
          faviconUrl: input.faviconUrl ?? null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        get().prependOrUpdate(optimistic);
      }

      const clearPending = () => {
        set((current) => {
          const pendingUrls = { ...current.pendingUrls };
          delete pendingUrls[key];
          return { pendingUrls, saving: false };
        });
      };

      try {
        if (wasBookmarked) {
          if (existingId && !existingId.startsWith('optimistic-')) {
            await bookmarkService.remove(existingId);
          } else {
            await bookmarkService.removeByUrl(input.url);
          }
          clearPending();
          void import('@/browser/suggestions').then(({ suggestionService }) => {
            suggestionService.invalidate();
          });
          return { bookmarked: false, bookmark: null };
        }

        const bookmark = await bookmarkService.add(input);
        get().prependOrUpdate(bookmark);
        clearPending();
        void import('@/browser/suggestions').then(({ suggestionService }) => {
          suggestionService.invalidate();
        });
        return { bookmarked: true, bookmark };
      } catch (error) {
        set({
          items: previousItems,
          total: previousTotal,
          urlIndex: previousIndex,
          saving: false,
          error: getErrorMessage(error, 'Failed to update bookmark'),
          pendingUrls: (() => {
            const pending = { ...get().pendingUrls };
            delete pending[key];
            return pending;
          })(),
        });

        return {
          bookmarked: wasBookmarked,
          bookmark:
            previousItems.find((item) => normalizeKey(item.url) === key) ?? null,
          error: getErrorMessage(error, 'Failed to update bookmark'),
        };
      }
    },
    clear: async () => {
      try {
        await bookmarkService.clear();
        set({
          ...initialBookmarksState,
          ready: true,
          initialized: true,
        });
        return true;
      } catch (error) {
        set({ error: getErrorMessage(error, 'Failed to clear bookmarks') });
        return false;
      }
    },
    reset: () => {
      loadRequestId += 1;
      loadMoreInFlight = false;
      set(initialBookmarksState);
    },
  };
}
