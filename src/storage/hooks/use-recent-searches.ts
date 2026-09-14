import { useEffect } from 'react';

import {
  selectRecentSearchItems,
  selectRecentSearchesError,
  selectRecentSearchesHasMore,
  selectRecentSearchesLoading,
  selectRecentSearchesQuery,
  selectRecentSearchesTotal,
  useRecentSearchesStore,
} from '@/store/recent-searches';

export interface UseRecentSearchesOptions {
  autoLoad?: boolean;
}

export function useRecentSearches(options: UseRecentSearchesOptions = {}) {
  const { autoLoad = true } = options;

  const items = useRecentSearchesStore(selectRecentSearchItems);
  const total = useRecentSearchesStore(selectRecentSearchesTotal);
  const loading = useRecentSearchesStore(selectRecentSearchesLoading);
  const refreshing = useRecentSearchesStore((state) => state.refreshing);
  const error = useRecentSearchesStore(selectRecentSearchesError);
  const hasMore = useRecentSearchesStore(selectRecentSearchesHasMore);
  const query = useRecentSearchesStore(selectRecentSearchesQuery);
  const ready = useRecentSearchesStore((state) => state.ready);

  const load = useRecentSearchesStore((state) => state.load);
  const refresh = useRecentSearchesStore((state) => state.refresh);
  const loadMore = useRecentSearchesStore((state) => state.loadMore);
  const search = useRecentSearchesStore((state) => state.search);
  const record = useRecentSearchesStore((state) => state.record);
  const remove = useRecentSearchesStore((state) => state.remove);
  const clear = useRecentSearchesStore((state) => state.clear);
  const setSort = useRecentSearchesStore((state) => state.setSort);

  useEffect(() => {
    if (autoLoad && !ready && !loading) {
      void load(1);
    }
  }, [autoLoad, ready, loading, load]);

  return {
    items,
    total,
    loading,
    refreshing,
    error,
    hasMore,
    query,
    ready,
    load,
    refresh,
    loadMore,
    search,
    record,
    remove,
    clear,
    setSort,
  };
}
