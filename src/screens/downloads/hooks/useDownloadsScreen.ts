import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { downloadEngine } from '@/downloads/engine';
import { DownloadEngineError } from '@/downloads/engine/errors';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { translate, type TranslationKey } from '@/localization';
import {
  consumeSecondaryDestinationIntent,
  downloadDetailsPath,
  navigation,
  routePaths,
} from '@/navigation';
import { useDownloads } from '@/storage/hooks';
import {
  selectDownloadSectionMembershipSignature,
  useDownloadsStore,
  type DownloadSortOption,
  type DownloadUiFilter,
} from '@/store/downloads';

import { SEARCH_DEBOUNCE_MS } from '../constants/downloads.constants';
import { groupDownloadsIntoSections } from '../utils/download-format';

function localizeCompletedActionError(code: Parameters<typeof completedActionErrorMessageKey>[0]): string {
  return translate(completedActionErrorMessageKey(code) as TranslationKey);
}

export function useDownloadsScreen() {
  const {
    orderedIds,
    itemsById,
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
    load,
    refresh,
    loadMore,
    search,
    pause,
    resume,
    cancel,
    retry,
    remove,
    setQuery,
    setStatusFilter,
    setSort,
  } = useDownloads({ autoLoad: true });

  const [searchDraft, setSearchDraft] = useState(query);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFocusedOnceRef = useRef(false);

  const sectionMembership = useDownloadsStore(
    selectDownloadSectionMembershipSignature,
  );

  const sections = useMemo(() => {
    void sectionMembership;
    return groupDownloadsIntoSections(
      orderedIds,
      useDownloadsStore.getState().itemsById,
    );
  }, [orderedIds, sectionMembership]);

  const showSections = statusFilter === 'all';

  const status = useMemo(() => {
    // Only block the screen on the true cold start — never on focus refresh.
    if (!initialized && loading && orderedIds.length === 0) {
      return 'loading' as const;
    }

    if (error && orderedIds.length === 0 && !initialized) {
      return 'error' as const;
    }

    if (error && orderedIds.length === 0 && initialized && !ready) {
      return 'error' as const;
    }

    const canShowEmpty = initialized || ready;

    if (canShowEmpty && orderedIds.length === 0 && searchDraft.trim()) {
      return 'empty-search' as const;
    }

    if (
      canShowEmpty &&
      orderedIds.length === 0 &&
      statusFilter !== 'all' &&
      !searchDraft.trim()
    ) {
      return statusFilter === 'completed'
        ? ('empty-completed' as const)
        : ('empty-filter' as const);
    }

    if (canShowEmpty && orderedIds.length === 0) {
      return 'empty' as const;
    }

    return 'ready' as const;
  }, [
    error,
    initialized,
    loading,
    orderedIds.length,
    ready,
    searchDraft,
    statusFilter,
  ]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const intent = consumeSecondaryDestinationIntent();
      if (intent?.domain === 'downloads') {
        hasFocusedOnceRef.current = true;
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setSearchDraft('');
        setQuery('');
        setStatusFilter(intent.statusFilter);
        if (intent.sort) {
          setSort(intent.sort);
        }
        void load(1);
        return;
      }

      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      void refresh();
      // Lightweight local-file refresh for visible completed rows (Open/Share truth).
      const state = useDownloadsStore.getState();
      let probed = 0;
      for (const id of state.orderedIds) {
        if (probed >= 8) {
          break;
        }
        const item = state.itemsById[id];
        if (item?.status !== 'COMPLETED') {
          continue;
        }
        probed += 1;
        void downloadEngine.refreshCompletedLocalFile(id);
      }
    }, [load, refresh, setQuery, setSort, setStatusFilter]),
  );

  const applyRemoteQuery = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      setQuery(trimmed);
      void search(trimmed);
    },
    [search, setQuery],
  );

  const onChangeSearch = useCallback(
    (value: string) => {
      setSearchDraft(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        applyRemoteQuery(value);
      }, SEARCH_DEBOUNCE_MS);
    },
    [applyRemoteQuery],
  );

  const onSubmitSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      const trimmed = value.trim();
      setSearchDraft(trimmed);
      applyRemoteQuery(trimmed);
    },
    [applyRemoteQuery],
  );

  const onSelectFilter = useCallback(
    (next: DownloadUiFilter) => {
      if (next === statusFilter) {
        setFilterSheetVisible(false);
        return;
      }
      setStatusFilter(next);
      setFilterSheetVisible(false);
      void load(1);
    },
    [load, setStatusFilter, statusFilter],
  );

  const onSelectSort = useCallback(
    (next: DownloadSortOption) => {
      if (next === sort) {
        setSortSheetVisible(false);
        return;
      }
      setSort(next);
      setSortSheetVisible(false);
      void load(1);
    },
    [load, setSort, sort],
  );

  const resetControls = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setSearchDraft('');
    setQuery('');
    setStatusFilter('all');
    setSort('newest');
    void search('');
  }, [search, setQuery, setSort, setStatusFilter]);

  const controlsDirty =
    Boolean(searchDraft.trim()) ||
    statusFilter !== 'all' ||
    sort !== 'newest';

  const requestDelete = useCallback((id: string) => {
    setDeleteTargetId(id);
    setActionError(null);
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
    setActionError(null);
    try {
      const ok = await remove(deleteTargetId);
      if (ok) {
        setDeleteTargetId(null);
      } else {
        setActionError('Couldn’t remove this download.');
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetId, remove]);

  const onPause = useCallback(
    async (id: string) => {
      setActionError(null);
      const result = await pause(id);
      if (!result) {
        const storeError = useDownloadsStore.getState().error;
        setActionError(storeError?.trim() || 'Couldn’t pause this download.');
      }
    },
    [pause],
  );

  const onResume = useCallback(
    async (id: string) => {
      setActionError(null);
      const result = await resume(id);
      if (!result) {
        const storeError = useDownloadsStore.getState().error;
        setActionError(
          storeError?.trim() || 'Unable to resume this download.',
        );
      }
    },
    [resume],
  );

  const onCancel = useCallback(
    async (id: string) => {
      setActionError(null);
      const result = await cancel(id);
      if (!result) {
        setActionError('Couldn’t cancel this download.');
      }
    },
    [cancel],
  );

  const onRetry = useCallback(
    async (id: string) => {
      setActionError(null);
      const result = await retry(id);
      if (!result) {
        const storeError = useDownloadsStore.getState().error;
        setActionError(storeError?.trim() || 'Unable to retry this download.');
      }
    },
    [retry],
  );

  const onOpen = useCallback(async (id: string) => {
    setActionError(null);
    try {
      const { openCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await openCompletedFile(id);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch (error) {
      setActionError(
        error instanceof DownloadEngineError
          ? error.message
          : translate('files.unavailable'),
      );
    }
  }, []);

  const onShare = useCallback(async (id: string) => {
    setActionError(null);
    try {
      const { shareCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await shareCompletedFile(id);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch (error) {
      setActionError(
        error instanceof DownloadEngineError
          ? error.message
          : translate('files.unavailable'),
      );
    }
  }, []);

  const openBrowser = useCallback(() => {
    navigation.navigate(routePaths.browser);
  }, []);

  const openDetails = useCallback((id: string) => {
    navigation.push(downloadDetailsPath(id));
  }, []);

  const countLabel =
    total > 0
      ? `${total} download${total === 1 ? '' : 's'}`
      : translate('downloads.title');

  return {
    orderedIds,
    itemsById,
    sections,
    showSections,
    total,
    countLabel,
    loading,
    loadingMore,
    refreshing,
    error: actionError || error,
    hasMore,
    status,
    searchDraft,
    statusFilter,
    sort,
    filterSheetVisible,
    sortSheetVisible,
    deleteTargetId,
    deleting,
    controlsDirty,
    onChangeSearch,
    onSubmitSearch,
    openFilterSheet: () => setFilterSheetVisible(true),
    closeFilterSheet: () => setFilterSheetVisible(false),
    openSortSheet: () => setSortSheetVisible(true),
    closeSortSheet: () => setSortSheetVisible(false),
    onSelectFilter,
    onSelectSort,
    resetControls,
    requestDelete,
    cancelDelete,
    confirmDelete,
    onPause,
    onResume,
    onCancel,
    onRetry,
    onOpen,
    onShare,
    openBrowser,
    openDetails,
    refresh,
    loadMore,
  };
}

export type DownloadsScreenModel = ReturnType<typeof useDownloadsScreen>;
