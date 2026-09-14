import { useCallback, useMemo, useState } from 'react';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { useBrowserHistory } from '@/storage/hooks';

import { groupHistoryByDay } from '../utils/history-format';

export function useHistoryScreen() {
  const {
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
    remove,
    clear,
  } = useBrowserHistory({ autoLoad: true });

  const [clearVisible, setClearVisible] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query);

  const sections = useMemo(() => groupHistoryByDay(items), [items]);

  const status = useMemo(() => {
    if (!initialized && loading && items.length === 0) {
      return 'loading' as const;
    }

    if (error && items.length === 0 && !initialized) {
      return 'error' as const;
    }

    if ((ready || initialized) && items.length === 0 && !query) {
      return 'empty' as const;
    }

    if ((ready || initialized) && items.length === 0 && query) {
      return 'empty-search' as const;
    }

    return 'ready' as const;
  }, [error, initialized, items.length, loading, query, ready]);

  const onChangeSearch = useCallback((value: string) => {
    setSearchDraft(value);
  }, []);

  const onSubmitSearch = useCallback(
    (value: string) => {
      void search(value.trim());
    },
    [search],
  );

  const onClearSearch = useCallback(() => {
    setSearchDraft('');
    void search('');
  }, [search]);

  const openEntry = useCallback((url: string) => {
    pendingNavigationService.set(url, {
      targetTabId: useBrowserStore.getState().activeTabId,
    });
    navigation.navigate(routePaths.browser);
  }, []);

  const requestDelete = useCallback((id: string) => {
    setDeleteTargetId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setDeleteTargetId(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargetId) {
      return;
    }

    setDeleting(true);
    try {
      await remove(deleteTargetId);
      setDeleteTargetId(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetId, remove]);

  const openClear = useCallback(() => {
    setClearVisible(true);
  }, []);

  const cancelClear = useCallback(() => {
    if (clearing) {
      return;
    }
    setClearVisible(false);
  }, [clearing]);

  const confirmClear = useCallback(async () => {
    setClearing(true);
    try {
      await clear();
      setClearVisible(false);
      setSearchDraft('');
    } finally {
      setClearing(false);
    }
  }, [clear]);

  const openBrowser = useCallback(() => {
    navigation.navigate(routePaths.browser);
  }, []);

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
    sections,
    status,
    searchDraft,
    clearVisible,
    deleteTargetId,
    deleting,
    clearing,
    onChangeSearch,
    onSubmitSearch,
    onClearSearch,
    openEntry,
    requestDelete,
    cancelDelete,
    confirmDelete,
    openClear,
    cancelClear,
    confirmClear,
    openBrowser,
  };
}

export type HistoryScreenModel = ReturnType<typeof useHistoryScreen>;
