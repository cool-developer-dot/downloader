import { useEffect } from 'react';

import {
  selectHistoryError,
  selectHistoryHasMore,
  selectHistoryInitialized,
  selectHistoryItems,
  selectHistoryLastSync,
  selectHistoryLoading,
  selectHistoryLoadingMore,
  selectHistoryQuery,
  selectHistoryReady,
  selectHistoryRefreshing,
  selectHistoryTotal,
  useHistoryStore,
} from '@/store/history';

export interface UseBrowserHistoryOptions {
  autoLoad?: boolean;
}

export function useBrowserHistory(options: UseBrowserHistoryOptions = {}) {
  const { autoLoad = true } = options;

  const items = useHistoryStore(selectHistoryItems);
  const total = useHistoryStore(selectHistoryTotal);
  const loading = useHistoryStore(selectHistoryLoading);
  const loadingMore = useHistoryStore(selectHistoryLoadingMore);
  const refreshing = useHistoryStore(selectHistoryRefreshing);
  const error = useHistoryStore(selectHistoryError);
  const hasMore = useHistoryStore(selectHistoryHasMore);
  const query = useHistoryStore(selectHistoryQuery);
  const ready = useHistoryStore(selectHistoryReady);
  const initialized = useHistoryStore(selectHistoryInitialized);
  const lastSync = useHistoryStore(selectHistoryLastSync);

  const load = useHistoryStore((state) => state.load);
  const refresh = useHistoryStore((state) => state.refresh);
  const loadMore = useHistoryStore((state) => state.loadMore);
  const search = useHistoryStore((state) => state.search);
  const recordVisit = useHistoryStore((state) => state.addVisit);
  const remove = useHistoryStore((state) => state.remove);
  const clear = useHistoryStore((state) => state.clear);
  const setSort = useHistoryStore((state) => state.setSort);
  const setQuery = useHistoryStore((state) => state.setQuery);

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
    error,
    hasMore,
    query,
    ready,
    initialized,
    lastSync,
    load,
    refresh,
    loadMore,
    search,
    recordVisit,
    remove,
    clear,
    setSort,
    setQuery,
  };
}
