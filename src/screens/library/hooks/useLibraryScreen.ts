import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import type { DownloadItem } from '@/api';
import type { LocalDownloadRecord } from '@/downloads/engine/types';
import { listLocalRecords } from '@/downloads/engine/persistence';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import {
  applyLibraryQuery,
  assembleCanonicalItems,
  configureLibraryRepository,
  LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  listDistinctQualities,
  reconcileAvailability,
  type FileAssessment,
  type MediaLibraryItem,
} from '@/library';
import { translate, type TranslationKey } from '@/localization';
import { navigation, openPlayer, routePaths, consumeSecondaryDestinationIntent } from '@/navigation';
import {
  buildPlaybackSummaryMap,
  listLocalPlaybackSummaries,
  useContinueWatchingQuery,
  useRecentPlaybackQuery,
} from '@/playback/hooks';
import { enrichLibraryWithPlayback } from '@/playback/enrich-library';
import { isContinueWatchingEligible } from '@/playback/domain/continue-watching';
import { getCachedFavoriteMediaIds } from '@/storage/services/catalog-persist';
import {
  selectDownloadCatalogIdentitySignature,
  selectLibraryTransferSignature,
  useDownloadsStore,
} from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';
import { useFoldersStore } from '@/store/organization/folders';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useLibraryStore } from '@/store/library';

function localizeCompletedActionError(
  code: Parameters<typeof completedActionErrorMessageKey>[0],
): string {
  return translate(completedActionErrorMessageKey(code) as TranslationKey);
}

export function useLibraryScreen() {
  const searchQuery = useLibraryStore((state) => state.searchQuery);
  const filter = useLibraryStore((state) => state.filter);
  const sort = useLibraryStore((state) => state.sort);
  const quality = useLibraryStore((state) => state.quality);
  const folderId = useLibraryStore((state) => state.folderId);
  const viewMode = useLibraryStore((state) => state.viewMode);
  const availabilityById = useLibraryStore((state) => state.availabilityById);
  const sourceRevision = useLibraryStore((state) => state.sourceRevision);
  const loading = useLibraryStore((state) => state.loading);
  const refreshing = useLibraryStore((state) => state.refreshing);
  const error = useLibraryStore((state) => state.error);
  const initialized = useLibraryStore((state) => state.initialized);

  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery);
  const setFilter = useLibraryStore((state) => state.setFilter);
  const setFolderId = useLibraryStore((state) => state.setFolderId);
  const setSort = useLibraryStore((state) => state.setSort);
  const setQuality = useLibraryStore((state) => state.setQuality);
  const setViewMode = useLibraryStore((state) => state.setViewMode);
  const setAvailability = useLibraryStore((state) => state.setAvailability);
  const setLoading = useLibraryStore((state) => state.setLoading);
  const setRefreshing = useLibraryStore((state) => state.setRefreshing);
  const setError = useLibraryStore((state) => state.setError);
  const markReconciled = useLibraryStore((state) => state.markReconciled);
  const markInitialized = useLibraryStore((state) => state.markInitialized);
  const resetQuery = useLibraryStore((state) => state.resetQuery);

  const catalogIdentity = useDownloadsStore(
    selectDownloadCatalogIdentitySignature,
  );
  const transferSignature = useDownloadsStore(selectLibraryTransferSignature);
  const urlIndex = useFavoritesStore((state) => state.urlIndex);
  const ensureFavorites = useFavoritesStore((state) => state.ensureReady);

  const foldersById = useFoldersStore((state) => state.itemsById);
  const ensureFoldersReady = useFoldersStore((state) => state.ensureReady);

  const folderIdByMediaId = useMediaFolderAssignmentsStore((state) => state.folderIdByMediaId);
  const folderOrderedIds = useFoldersStore((state) => state.orderedIds);

  const [folderSelectionSheetVisible, setFolderSelectionSheetVisible] = useState(false);

  useEffect(() => {
    configureLibraryRepository({
      getDownloadItems: () => Object.values(useDownloadsStore.getState().itemsById),
      getTransfers: () => useDownloadsStore.getState().transferById,
      getFavoriteSourceKeys: () =>
        new Set(Object.keys(useFavoritesStore.getState().urlIndex)),
      getFavoriteMediaIds: () => getCachedFavoriteMediaIds(),
    });
  }, []);

  const [localRecords, setLocalRecords] = useState<LocalDownloadRecord[]>([]);
  const [searchDraft, setSearchDraft] = useState(searchQuery);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [qualitySheetVisible, setQualitySheetVisible] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const downloads = useMemo<DownloadItem[]>(() => {
    void catalogIdentity;
    return Object.values(useDownloadsStore.getState().itemsById);
  }, [catalogIdentity]);

  const favoriteKeys = useMemo(
    () => new Set(Object.keys(urlIndex)),
    [urlIndex],
  );

  const favoriteMediaIds = useMemo(
    () => getCachedFavoriteMediaIds(),
    [urlIndex, catalogIdentity, sourceRevision],
  );

  const assessments = useMemo(() => {
    const map: Record<string, FileAssessment> = {};
    for (const [id, availability] of Object.entries(availabilityById)) {
      map[id] = { availability, verifiedBytes: null };
    }
    return map;
  }, [availabilityById]);

  const canonicalItems = useMemo(() => {
    void transferSignature;
    const transfers = useDownloadsStore.getState().transferById;
    return assembleCanonicalItems({
      downloads,
      records: localRecords,
      transfers,
      remoteById: {},
      favoriteKeys,
      favoriteMediaIds,
      assessments,
      folderIdByMediaId,
      folderNameByFolderId: Object.keys(foldersById).reduce(
        (acc, id) => {
          acc[id] = foldersById[id]?.name ?? null;
          return acc;
        },
        {} as Record<string, string | null | undefined>,
      ),
    });
  }, [
    assessments,
    downloads,
    favoriteKeys,
    favoriteMediaIds,
    folderIdByMediaId,
    foldersById,
    localRecords,
    transferSignature,
  ]);

  const continueQuery = useContinueWatchingQuery();
  const recentQuery = useRecentPlaybackQuery(50);

  const playbackById = useMemo(() => {
    const local = listLocalPlaybackSummaries();
    return buildPlaybackSummaryMap([
      ...recentQuery.items,
      ...continueQuery.items,
      ...local,
    ]);
  }, [continueQuery.items, recentQuery.items]);

  const enrichedCanonical = useMemo(
    () => enrichLibraryWithPlayback(canonicalItems, playbackById),
    [canonicalItems, playbackById],
  );

  const queryResult = useMemo(
    () =>
      applyLibraryQuery(enrichedCanonical, {
        search: searchQuery,
        filter,
        sort,
        quality,
        folderId,
        recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
        nowMs: Date.now(),
      }),
    [enrichedCanonical, filter, folderId, quality, searchQuery, sort],
  );

  const continueWatchingItems = useMemo(() => {
    const libraryById = new Map(
      enrichedCanonical.map((item) => [item.id, item] as const),
    );
    const rows = [];
    for (const summary of continueQuery.items) {
      if (
        !isContinueWatchingEligible(summary, {
          localAvailable: libraryById.get(summary.mediaId)?.localAvailability === 'available',
        })
      ) {
        continue;
      }
      const media = libraryById.get(summary.mediaId);
      if (!media || media.localAvailability !== 'available') {
        continue;
      }
      rows.push({
        ...media,
        progressPercent: summary.progressPercent,
        positionSeconds: summary.positionSeconds,
        lastPlayedAt: summary.lastPlayedAt,
        completed: false,
        duration: media.duration ?? summary.durationSeconds,
      });
    }
    return rows;
  }, [continueQuery.items, enrichedCanonical]);

  const qualities = useMemo(
    () => listDistinctQualities(enrichedCanonical),
    [enrichedCanonical],
  );

  const loadLocalAndReconcile = useCallback(
    async (force: boolean) => {
      try {
        const records = await listLocalRecords();
        setLocalRecords(records);
        const availability = await reconcileAvailability(undefined, {
          force,
        });
        setAvailability(availability);
        markReconciled(Date.now());
        setError(null);
      } catch {
        setError('Couldn’t refresh files on this device.');
      } finally {
        markInitialized();
        setLoading(false);
        setRefreshing(false);
      }
    },
    [markInitialized, markReconciled, setAvailability, setError, setLoading, setRefreshing],
  );

  useEffect(() => {
    void ensureFavorites();
  }, [ensureFavorites]);

  useEffect(() => {
    void ensureFoldersReady();
  }, [ensureFoldersReady]);

  useFocusEffect(
    useCallback(() => {
      const intent = consumeSecondaryDestinationIntent();
      if (intent?.domain === 'library') {
        if (searchTimerRef.current) {
          clearTimeout(searchTimerRef.current);
          searchTimerRef.current = null;
        }
        setSearchDraft('');
        setSearchQuery('');
        setFilter(intent.filter);
      }

      if (!initialized) {
        setLoading(true);
      }
      void loadLocalAndReconcile(false);
    }, [initialized, loadLocalAndReconcile, setFilter, setLoading, setSearchQuery]),
  );

  // Download COMPLETED bumps sourceRevision (completion bridge) so a mounted
  // Library reloads local records. Completions already invalidate that id's
  // availability cache; TTL covers the rest.
  useEffect(() => {
    if (sourceRevision <= 0 || !initialized) {
      return;
    }
    void loadLocalAndReconcile(false);
  }, [initialized, loadLocalAndReconcile, sourceRevision]);

  const visibleItems: MediaLibraryItem[] = queryResult.items;
  const searchActive = searchQuery.trim().length > 0;
  const filterActive = filter !== 'all' || Boolean(quality) || Boolean(folderId);

  const status = useMemo(() => {
    if (!initialized && loading && visibleItems.length === 0) {
      return 'loading' as const;
    }
    if (error && !initialized && visibleItems.length === 0) {
      return 'error' as const;
    }
    if (initialized && visibleItems.length === 0 && searchActive) {
      return 'empty-search' as const;
    }
    if (initialized && visibleItems.length === 0 && filterActive && !searchActive) {
      return 'empty-filter' as const;
    }
    if (initialized && visibleItems.length === 0) {
      return 'empty' as const;
    }
    return 'ready' as const;
  }, [error, filterActive, initialized, loading, searchActive, visibleItems.length]);

  const controlsDirty =
    searchDraft.trim().length > 0 ||
    filter !== 'all' ||
    sort !== 'newest' ||
    Boolean(quality);

  const onChangeSearch = useCallback(
    (value: string) => {
      setSearchDraft(value);
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
      searchTimerRef.current = setTimeout(() => {
        setSearchQuery(value);
        searchTimerRef.current = null;
      }, LIBRARY_SEARCH_DEBOUNCE_MS);
    },
    [setSearchQuery],
  );

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, []);

  const onSelectFilter = useCallback(
    (next: typeof filter) => {
      if (next === 'folder') {
        setFilter(next);
        setFilterSheetVisible(false);
        setFolderSelectionSheetVisible(true);
        return;
      }

      setFilter(next);
      setFilterSheetVisible(false);
    },
    [setFilter],
  );

  const onCloseFolderSelection = useCallback(() => {
    setFolderSelectionSheetVisible(false);
  }, []);

  const onSelectFolderSelection = useCallback(
    (selectionId: string) => {
      // `selectionId` is either our UI sentinel or a real folderId.
      setFolderId(selectionId as string);
      setFolderSelectionSheetVisible(false);
    },
    [setFolderId],
  );

  const onSelectSort = useCallback(
    (next: typeof sort) => {
      setSort(next);
      setSortSheetVisible(false);
    },
    [setSort],
  );

  const onSelectQuality = useCallback(
    (next: string | null) => {
      setQuality(next);
      setQualitySheetVisible(false);
      setFilterSheetVisible(false);
    },
    [setQuality],
  );

  const onToggleViewMode = useCallback(() => {
    setViewMode(viewMode === 'grid' ? 'list' : 'grid');
  }, [setViewMode, viewMode]);

  const onReset = useCallback(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    setSearchDraft('');
    resetQuery();
  }, [resetQuery]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([continueQuery.refetch(), recentQuery.refetch()]);
    await loadLocalAndReconcile(true);
  }, [continueQuery, loadLocalAndReconcile, recentQuery, setRefreshing]);

  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionSheetVisible = actionItemId != null;

  const openItemActions = useCallback((id: string) => {
    setActionError(null);
    setActionItemId(id);
  }, []);

  const closeItemActions = useCallback(() => {
    setActionItemId(null);
  }, []);

  const openItemExternal = useCallback(async (id: string) => {
    setActionError(null);
    try {
      const { openCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await openCompletedFile(id);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch {
      setActionError(translate('files.openFailed'));
    }
  }, []);

  const shareItem = useCallback(async (id: string) => {
    setActionError(null);
    try {
      const { shareCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await shareCompletedFile(id);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch {
      setActionError(translate('files.shareFailed'));
    }
  }, []);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionStatusMessage, setActionStatusMessage] = useState<string | null>(
    null,
  );

  const saveItemToDevice = useCallback(async (id: string) => {
    setActionError(null);
    setActionStatusMessage(null);
    try {
      const { saveCompletedFileToDevice } = await import(
        '@/downloads/completed-file/export/export-service'
      );
      const result = await saveCompletedFileToDevice(id);
      if (result.ok) {
        setActionStatusMessage(
          result.kind === 'already_saved'
            ? 'already_saved'
            : 'saved',
        );
        return;
      }
      if ('cancelled' in result && result.cancelled) {
        return;
      }
      if (!result.ok && result.error) {
        setActionError(result.error.message);
      }
    } catch {
      setActionError('Unable to save this file.');
    }
  }, []);

  const requestDeleteItem = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const cancelDeleteItem = useCallback(() => {
    if (deleteLoading) {
      return;
    }
    setDeleteConfirmId(null);
  }, [deleteLoading]);

  const confirmDeleteItem = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) {
      return;
    }
    setDeleteLoading(true);
    setActionError(null);
    try {
      const { deleteCompletedFileFromVidoraX } = await import(
        '@/downloads/completed-file/delete/delete-service'
      );
      const result = await deleteCompletedFileFromVidoraX(id);
      if (!result.ok) {
        setActionError(result.error.message);
        return;
      }
      setDeleteConfirmId(null);
      setActionItemId(null);
    } catch {
      setActionError('Unable to delete this download');
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteConfirmId]);

  const openDownloads = useCallback(() => {
    navigation.push(routePaths.downloads);
  }, []);

  const openWatchHistory = useCallback(() => {
    navigation.push(routePaths.watchHistory);
  }, []);

  return {
    visibleItems,
    continueWatchingItems,
    playableCount: queryResult.playableCount,
    sourceCount: queryResult.sourceCount,
    searchDraft,
    filter,
    folderId,
    sort,
    viewMode,
    quality,
    qualities,
    controlsDirty,
    filterSheetVisible,
    folderSelectionSheetVisible,
    sortSheetVisible,
    qualitySheetVisible,
    refreshing,
    loading,
    error,
    status,
    onChangeSearch,
    openFilterSheet: () => setFilterSheetVisible(true),
    closeFilterSheet: () => setFilterSheetVisible(false),
    closeFolderSelection: onCloseFolderSelection,
    onSelectFolderSelection,
    openSortSheet: () => setSortSheetVisible(true),
    closeSortSheet: () => setSortSheetVisible(false),
    openQualitySheet: () => setQualitySheetVisible(true),
    closeQualitySheet: () => setQualitySheetVisible(false),
    onSelectFilter,
    onSelectSort,
    onSelectQuality,
    onToggleViewMode,
    onReset,
    refresh,
    openPlayer,
    openItemActions,
    closeItemActions,
    actionSheetVisible,
    actionItemId,
    actionError,
    actionStatusMessage,
    clearActionStatusMessage: () => setActionStatusMessage(null),
    openItemExternal,
    shareItem,
    saveItemToDevice,
    requestDeleteItem,
    cancelDeleteItem,
    confirmDeleteItem,
    deleteConfirmId,
    deleteLoading,
    openDownloads,
    openWatchHistory,
  };
}
