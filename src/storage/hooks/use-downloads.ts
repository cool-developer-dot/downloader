import { useEffect } from 'react';

import {
  selectDownloadOrderedIds,
  selectDownloadsError,
  selectDownloadsHasMore,
  selectDownloadsInitialized,
  selectDownloadsLoading,
  selectDownloadsLoadingMore,
  selectDownloadsMutatingIds,
  selectDownloadsQuery,
  selectDownloadsReady,
  selectDownloadsRefreshing,
  selectDownloadsSort,
  selectDownloadsStatusFilter,
  selectDownloadsTotal,
  useDownloadsStore,
} from '@/store/downloads';

export interface UseDownloadsOptions {
  autoLoad?: boolean;
}

export function useDownloads(options: UseDownloadsOptions = {}) {
  const { autoLoad = true } = options;

  const orderedIds = useDownloadsStore(selectDownloadOrderedIds);
  const total = useDownloadsStore(selectDownloadsTotal);
  const loading = useDownloadsStore(selectDownloadsLoading);
  const loadingMore = useDownloadsStore(selectDownloadsLoadingMore);
  const refreshing = useDownloadsStore(selectDownloadsRefreshing);
  const error = useDownloadsStore(selectDownloadsError);
  const hasMore = useDownloadsStore(selectDownloadsHasMore);
  const query = useDownloadsStore(selectDownloadsQuery);
  const statusFilter = useDownloadsStore(selectDownloadsStatusFilter);
  const sort = useDownloadsStore(selectDownloadsSort);
  const ready = useDownloadsStore(selectDownloadsReady);
  const initialized = useDownloadsStore(selectDownloadsInitialized);
  const mutatingIds = useDownloadsStore(selectDownloadsMutatingIds);
  // Snapshot only — do not subscribe to the items map. Progress ticks clone
  // itemsById; list hosts must not rerender. Rows subscribe per id.

  const load = useDownloadsStore((state) => state.load);
  const refresh = useDownloadsStore((state) => state.refresh);
  const loadMore = useDownloadsStore((state) => state.loadMore);
  const search = useDownloadsStore((state) => state.search);
  const create = useDownloadsStore((state) => state.create);
  const pause = useDownloadsStore((state) => state.pause);
  const resume = useDownloadsStore((state) => state.resume);
  const cancel = useDownloadsStore((state) => state.cancel);
  const retry = useDownloadsStore((state) => state.retry);
  const remove = useDownloadsStore((state) => state.remove);
  const fetchOne = useDownloadsStore((state) => state.fetchOne);
  const setQuery = useDownloadsStore((state) => state.setQuery);
  const setStatusFilter = useDownloadsStore((state) => state.setStatusFilter);
  const setSort = useDownloadsStore((state) => state.setSort);

  useEffect(() => {
    if (autoLoad && !initialized && !loading) {
      void load(1);
    }
  }, [autoLoad, initialized, loading, load]);

  return {
    orderedIds,
    itemsById: useDownloadsStore.getState().itemsById,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    query,
    statusFilter,
    sort,
    ready,
    initialized,
    mutatingIds,
    load,
    refresh,
    loadMore,
    search,
    create,
    pause,
    resume,
    cancel,
    retry,
    remove,
    fetchOne,
    setQuery,
    setStatusFilter,
    setSort,
  };
}
