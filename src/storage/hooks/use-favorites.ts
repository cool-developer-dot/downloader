import { useEffect } from 'react';

import {
  selectFavoriteItemsById,
  selectFavoriteOrderedIds,
  selectFavoritesError,
  selectFavoritesHasMore,
  selectFavoritesInitialized,
  selectFavoritesLoading,
  selectFavoritesLoadingMore,
  selectFavoritesMutatingIds,
  selectFavoritesPendingUrls,
  selectFavoritesQuery,
  selectFavoritesReady,
  selectFavoritesRefreshing,
  selectFavoritesSaving,
  selectFavoritesSort,
  selectFavoritesTotal,
  selectFavoritesUrlIndex,
  useFavoritesStore,
} from '@/store/favorites';

export interface UseFavoritesOptions {
  autoLoad?: boolean;
}

export function useFavorites(options: UseFavoritesOptions = {}) {
  const { autoLoad = true } = options;

  const orderedIds = useFavoritesStore(selectFavoriteOrderedIds);
  const itemsById = useFavoritesStore(selectFavoriteItemsById);
  const total = useFavoritesStore(selectFavoritesTotal);
  const loading = useFavoritesStore(selectFavoritesLoading);
  const loadingMore = useFavoritesStore(selectFavoritesLoadingMore);
  const refreshing = useFavoritesStore(selectFavoritesRefreshing);
  const saving = useFavoritesStore(selectFavoritesSaving);
  const error = useFavoritesStore(selectFavoritesError);
  const hasMore = useFavoritesStore(selectFavoritesHasMore);
  const query = useFavoritesStore(selectFavoritesQuery);
  const sort = useFavoritesStore(selectFavoritesSort);
  const ready = useFavoritesStore(selectFavoritesReady);
  const initialized = useFavoritesStore(selectFavoritesInitialized);
  const urlIndex = useFavoritesStore(selectFavoritesUrlIndex);
  const pendingUrls = useFavoritesStore(selectFavoritesPendingUrls);
  const mutatingIds = useFavoritesStore(selectFavoritesMutatingIds);

  const load = useFavoritesStore((state) => state.load);
  const refresh = useFavoritesStore((state) => state.refresh);
  const loadMore = useFavoritesStore((state) => state.loadMore);
  const search = useFavoritesStore((state) => state.search);
  const ensureReady = useFavoritesStore((state) => state.ensureReady);
  const add = useFavoritesStore((state) => state.add);
  const remove = useFavoritesStore((state) => state.remove);
  const removeBySourceUrl = useFavoritesStore((state) => state.removeBySourceUrl);
  const toggleOptimistic = useFavoritesStore((state) => state.toggleOptimistic);
  const resolveFavoriteForUrl = useFavoritesStore(
    (state) => state.resolveFavoriteForUrl,
  );
  const isUrlFavorited = useFavoritesStore((state) => state.isUrlFavorited);
  const setQuery = useFavoritesStore((state) => state.setQuery);
  const setSort = useFavoritesStore((state) => state.setSort);

  useEffect(() => {
    if (autoLoad && !initialized && !loading) {
      void load(1);
    }
  }, [autoLoad, initialized, loading, load]);

  return {
    orderedIds,
    itemsById,
    total,
    loading,
    loadingMore,
    refreshing,
    saving,
    error,
    hasMore,
    query,
    sort,
    ready,
    initialized,
    urlIndex,
    pendingUrls,
    mutatingIds,
    load,
    refresh,
    loadMore,
    search,
    ensureReady,
    add,
    remove,
    removeBySourceUrl,
    toggleOptimistic,
    resolveFavoriteForUrl,
    isUrlFavorited,
    setQuery,
    setSort,
  };
}
