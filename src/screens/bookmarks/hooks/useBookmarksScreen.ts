import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { pendingNavigationService } from '@/browser/services';
import { useBrowserStore } from '@/browser/stores';
import { navigation, routePaths } from '@/navigation';
import { useBookmarks } from '@/storage/hooks';
import type { BookmarkEntry } from '@/storage/types';

const SEARCH_DEBOUNCE_MS = 220;

function filterBookmarksLocally(
  items: BookmarkEntry[],
  query: string,
): BookmarkEntry[] {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return items;
  }

  return items.filter((item) => {
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.url.toLowerCase().includes(normalized) ||
      item.hostname.toLowerCase().includes(normalized)
    );
  });
}

export function useBookmarksScreen() {
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
    load,
    refresh,
    loadMore,
    remove,
    clear,
    setQuery,
  } = useBookmarks({ autoLoad: true });

  const [clearVisible, setClearVisible] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredItems = useMemo(
    () => filterBookmarksLocally(items, searchDraft),
    [items, searchDraft],
  );

  const status = useMemo(() => {
    if (!initialized && loading && items.length === 0) {
      return 'loading' as const;
    }

    if (error && items.length === 0 && !initialized) {
      return 'error' as const;
    }

    if ((ready || initialized) && items.length === 0 && !searchDraft.trim()) {
      return 'empty' as const;
    }

    if ((ready || initialized) && filteredItems.length === 0 && searchDraft.trim()) {
      return 'empty-search' as const;
    }

    return 'ready' as const;
  }, [
    error,
    filteredItems.length,
    initialized,
    items.length,
    loading,
    ready,
    searchDraft,
  ]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const onChangeSearch = useCallback(
    (value: string) => {
      setSearchDraft(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        setQuery(value.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [setQuery],
  );

  const onSubmitSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      const trimmed = value.trim();
      setSearchDraft(trimmed);
      setQuery(trimmed);
    },
    [setQuery],
  );

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
      setQuery('');
    } finally {
      setClearing(false);
    }
  }, [clear, setQuery]);

  const openBrowser = useCallback(() => {
    navigation.navigate(routePaths.browser);
  }, []);

  return {
    items: filteredItems,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore: searchDraft.trim() ? false : hasMore,
    ready,
    initialized,
    load,
    refresh,
    loadMore,
    status,
    searchDraft,
    clearVisible,
    deleteTargetId,
    deleting,
    clearing,
    onChangeSearch,
    onSubmitSearch,
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

export type BookmarksScreenModel = ReturnType<typeof useBookmarksScreen>;
