import { useEffect } from 'react';

import {
  selectBookmarkItems,
  selectBookmarksError,
  selectBookmarksHasMore,
  selectBookmarksInitialized,
  selectBookmarksLoading,
  selectBookmarksLoadingMore,
  selectBookmarksPendingUrls,
  selectBookmarksQuery,
  selectBookmarksReady,
  selectBookmarksRefreshing,
  selectBookmarksSaving,
  selectBookmarksTotal,
  selectBookmarksUrlIndex,
  useBookmarksStore,
} from '@/store/bookmarks';

export interface UseBookmarksOptions {
  autoLoad?: boolean;
}

export function useBookmarks(options: UseBookmarksOptions = {}) {
  const { autoLoad = true } = options;

  const items = useBookmarksStore(selectBookmarkItems);
  const total = useBookmarksStore(selectBookmarksTotal);
  const loading = useBookmarksStore(selectBookmarksLoading);
  const loadingMore = useBookmarksStore(selectBookmarksLoadingMore);
  const refreshing = useBookmarksStore(selectBookmarksRefreshing);
  const saving = useBookmarksStore(selectBookmarksSaving);
  const error = useBookmarksStore(selectBookmarksError);
  const hasMore = useBookmarksStore(selectBookmarksHasMore);
  const query = useBookmarksStore(selectBookmarksQuery);
  const ready = useBookmarksStore(selectBookmarksReady);
  const initialized = useBookmarksStore(selectBookmarksInitialized);
  const urlIndex = useBookmarksStore(selectBookmarksUrlIndex);
  const pendingUrls = useBookmarksStore(selectBookmarksPendingUrls);

  const load = useBookmarksStore((state) => state.load);
  const refresh = useBookmarksStore((state) => state.refresh);
  const loadMore = useBookmarksStore((state) => state.loadMore);
  const search = useBookmarksStore((state) => state.search);
  const add = useBookmarksStore((state) => state.add);
  const update = useBookmarksStore((state) => state.update);
  const remove = useBookmarksStore((state) => state.remove);
  const removeByUrl = useBookmarksStore((state) => state.removeByUrl);
  const toggle = useBookmarksStore((state) => state.toggle);
  const toggleOptimistic = useBookmarksStore((state) => state.toggleOptimistic);
  const clear = useBookmarksStore((state) => state.clear);
  const setSort = useBookmarksStore((state) => state.setSort);
  const setQuery = useBookmarksStore((state) => state.setQuery);
  const isUrlBookmarked = useBookmarksStore((state) => state.isUrlBookmarked);
  const resolveBookmarkForUrl = useBookmarksStore(
    (state) => state.resolveBookmarkForUrl,
  );

  useEffect(() => {
    if (autoLoad && !initialized && !loading) {
      void load(1);
    }
  }, [autoLoad, initialized, loading, load]);

  return {
    items,
    total,
    loading,
    loadingMore,
    refreshing,
    saving,
    error,
    hasMore,
    query,
    ready,
    initialized,
    urlIndex,
    pendingUrls,
    load,
    refresh,
    loadMore,
    search,
    add,
    update,
    remove,
    removeByUrl,
    toggle,
    toggleOptimistic,
    clear,
    setSort,
    setQuery,
    isUrlBookmarked,
    resolveBookmarkForUrl,
    isBookmarked: isUrlBookmarked,
  };
}
