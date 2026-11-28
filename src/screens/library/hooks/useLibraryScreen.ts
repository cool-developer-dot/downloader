import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useBinStore } from '@/files/trash/bin-store';
import type { DownloadItem } from '@/api';
import type { LocalDownloadRecord } from '@/downloads/engine/types';
import { listLocalRecords } from '@/downloads/engine/persistence';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { ensureV2LibraryHydrated, reconcileV2Library } from '@/downloads/v2';
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
// P9 Library stats: Most played (#626), the length filter (#711), hidden folders (#628).
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';
import type { DurationBucket } from '@/library/duration-buckets';
import { applyFolderExclusion, countExcluded } from '@/library/folder-exclusion';
import {
  backfillLibraryLengths,
  loadLibraryDurations,
  resetLibraryDurationBucket,
  setLibraryDurationBucket,
  useLibraryStatsStore,
} from '@/library/library-stats-store';
// Files F10 #910: a locked folder's videos stay out of the Player tab until it is opened with the PIN.
import { hiddenFolderIds, useLockedNowIds } from '@/files/ui/locked-folders';
// Files F7 #911: a hidden file stays out of the Player tab until Show hidden files is on.
import { withoutHiddenItems } from '@/files/organize/hidden-items';
import { useFilesViewSettings } from '@/files/ui/files-view-settings';
import { requestDelete as requestFilesDelete, runDelete as runFilesDelete } from '@/files/trash/useDeleteWithUndo';
import { useItemHiddenStore } from '@/library/item-organize-store';
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
  selectAllDownloadItems,
  selectDownloadCatalogIdentityRevision,
  selectLibraryTransferRevision,
  useDownloadsStore,
} from '@/store/downloads';
import { useFavoritesStore } from '@/store/favorites';
import { useFoldersStore } from '@/store/organization/folders';
import { useMediaFolderAssignmentsStore } from '@/store/organization/folder-assignments';
import { useLibraryStore } from '@/store/library';

/** P9 #711: the background length backfill starts this long after the Library's list last changed. */
const LENGTH_BACKFILL_START_DELAY_MS = 3000;

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
  const lastReconciledAt = useLibraryStore((state) => state.lastReconciledAt);

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
    selectDownloadCatalogIdentityRevision,
  );
  const transferSignature = useDownloadsStore(selectLibraryTransferRevision);
  const urlIndex = useFavoritesStore((state) => state.urlIndex);
  const ensureFavorites = useFavoritesStore((state) => state.ensureReady);

  const foldersById = useFoldersStore((state) => state.itemsById);
  const ensureFoldersReady = useFoldersStore((state) => state.ensureReady);

  const folderIdByMediaId = useMediaFolderAssignmentsStore((state) => state.folderIdByMediaId);
  const folderOrderedIds = useFoldersStore((state) => state.orderedIds);

  const [folderSelectionSheetVisible, setFolderSelectionSheetVisible] = useState(false);

  useEffect(() => {
    configureLibraryRepository({
      getDownloadItems: () => selectAllDownloadItems(useDownloadsStore.getState()),
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
    return selectAllDownloadItems(useDownloadsStore.getState());
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

  // F13: an item moved to (or back from) the recycle bin leaves (or rejoins) the list at once.
  const binEntries = useBinStore((state) => state.entries);

  const canonicalItems = useMemo(() => {
    void transferSignature;
    void binEntries;
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
    binEntries,
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

  // ── P9 Library stats ─────────────────────────────────────────────────────────────────────────────────────────
  // Play counts for Most played (#626), lengths for the length filter (#711: the items carry none of their own, so
  // the native library's measured length, else the playback record's), and the hidden folders (#628).
  const playCounts = useLibraryStatsStore((state) => state.playCounts);
  const nativeDurations = useLibraryStatsStore((state) => state.durationById);
  const durationBucket = useLibraryStatsStore((state) => state.durationBucket);
  const excludedFolderIds = useLibraryStatsStore((state) => state.excludedFolderIds);
  const durationById = useMemo(() => {
    const merged: Record<string, number> = {};
    for (const [id, summary] of playbackById) {
      if (Number.isFinite(summary.durationSeconds) && summary.durationSeconds > 0) {
        merged[id] = summary.durationSeconds;
      }
    }
    return { ...merged, ...nativeDurations };
  }, [nativeDurations, playbackById]);
  // Lengths: asked for at once while a length filter is chosen (once per video per run), and filled in the background
  // a few seconds after the list settles, whatever the filter (P9 backfill: the existing MediaInfo probe, a few at a
  // time, kept in media_play_stats).
  useEffect(() => {
    const missing = enrichedCanonical.filter((item) => item.duration == null).map((item) => item.id);
    if (durationBucket !== 'any') {
      void loadLibraryDurations(missing);
    }
    const timer = setTimeout(() => {
      void backfillLibraryLengths(missing);
    }, LENGTH_BACKFILL_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [durationBucket, enrichedCanonical]);
  const hiddenFolderVideoCount = useMemo(
    () => countExcluded(enrichedCanonical, excludedFolderIds),
    [enrichedCanonical, excludedFolderIds],
  );
  // ── end P9 ───────────────────────────────────────────────────────────────────────────────────────────────────

  // Files F10 #910: locked folders (and the folders under them) join the folders the query leaves out, but not P9's
  // own list — they are not counted as "hidden" and don't show in the folder visibility sheet.
  const lockedNow = useLockedNowIds();
  const queryExcludedFolderIds = useMemo(() => {
    if (lockedNow.length === 0) {
      return excludedFolderIds;
    }
    const folders = Object.values(foldersById).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: (folder as { parentId?: string | null }).parentId ?? null,
    }));
    return [...new Set([...excludedFolderIds, ...hiddenFolderIds(lockedNow, folders)])];
  }, [excludedFolderIds, foldersById, lockedNow]);

  const hiddenItemIds = useItemHiddenStore((state) => state.hiddenIds);
  const { showHidden } = useFilesViewSettings();
  const shownCanonical = useMemo(
    () => withoutHiddenItems(enrichedCanonical, new Set(hiddenItemIds), showHidden),
    [enrichedCanonical, hiddenItemIds, showHidden],
  );

  // "Recently downloaded" is judged at the library's last refresh (every focus and every completion
  // refreshes it), so rendering stays pure.
  const queryResult = useMemo(
    () =>
      applyLibraryQuery(shownCanonical, {
        search: searchQuery,
        filter,
        sort,
        quality,
        folderId,
        recentDownloadWindowMs: LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
        nowMs: lastReconciledAt ?? 0,
        durationBucket,
        durationById,
        excludedFolderIds: queryExcludedFolderIds,
        playCounts,
      }),
    [
      durationBucket,
      durationById,
      shownCanonical,
      queryExcludedFolderIds,
      filter,
      folderId,
      lastReconciledAt,
      playCounts,
      quality,
      searchQuery,
      sort,
    ],
  );

  const continueWatchingItems = useMemo(() => {
    // P9 #628: a hidden folder's videos stay out of the Library's Continue watching row too.
    const libraryById = new Map(
      // Files F7 #911: a hidden file stays out of Continue watching too.
      applyFolderExclusion(shownCanonical, queryExcludedFolderIds).map((item) => [item.id, item] as const),
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
  }, [continueQuery.items, queryExcludedFolderIds, shownCanonical]);

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
      // The whole library is loaded a moment after launch; opening Player first loads it now.
      void ensureV2LibraryHydrated();
      // A video deleted or moved outside VidoraX must not stay listed as playable.
      void reconcileV2Library();
    }, [initialized, loadLocalAndReconcile, setFilter, setLoading, setSearchQuery]),
  );

  // Download COMPLETED bumps sourceRevision (completion bridge) so a mounted
  // Library reloads local records. Completions already invalidate that id's
  // availability cache; TTL covers the rest. Focus covers the initial load.
  useEffect(
    () =>
      useLibraryStore.subscribe((state, previous) => {
        if (state.sourceRevision !== previous.sourceRevision && state.initialized) {
          void loadLocalAndReconcile(false);
        }
      }),
    [loadLocalAndReconcile],
  );

  const visibleItems: MediaLibraryItem[] = queryResult.items;
  const searchActive = searchQuery.trim().length > 0;
  // P9: a length filter, or hidden folders that hide something, make an empty list "No videos found", not "No downloads".
  const filterActive =
    filter !== 'all' ||
    Boolean(quality) ||
    Boolean(folderId) ||
    durationBucket !== 'any' ||
    hiddenFolderVideoCount > 0;

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
    Boolean(quality) ||
    durationBucket !== 'any';

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
    // P9: Reset clears the length filter too (hidden folders are a setting, kept).
    resetLibraryDurationBucket();
  }, [resetQuery]);

  const onSelectDuration = useCallback((bucket: DurationBucket) => {
    setLibraryDurationBucket(bucket);
  }, []);
  const [folderVisibilityVisible, setFolderVisibilityVisible] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([continueQuery.refetch(), recentQuery.refetch(), reconcileV2Library({ force: true })]);
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

  const cancelDeleteItem = useCallback(() => {
    if (deleteLoading) {
      return;
    }
    setDeleteConfirmId(null);
  }, [deleteLoading]);

  /** The delete itself, for one id (the dialog's Delete, or a request when Confirm before delete is off). */
  const runDeleteItem = useCallback(async (id: string) => {
    setDeleteLoading(true);
    setActionError(null);
    try {
      // F8's door (F13 underneath): into the recycle bin while it is on (restorable, with Undo), permanent otherwise.
      const result = await runFilesDelete({ ids: [id], source: 'player' });
      if (result.trashed.length === 0 && result.deleted.length === 0) {
        setActionError('Unable to delete this download');
        return;
      }
      setDeleteConfirmId(null);
      setActionItemId(null);
    } catch {
      setActionError('Unable to delete this download');
    } finally {
      setDeleteLoading(false);
    }
  }, []);

  const confirmDeleteItem = useCallback(async () => {
    const id = deleteConfirmId;
    if (!id) {
      return;
    }
    await runDeleteItem(id);
  }, [deleteConfirmId, runDeleteItem]);

  const requestDeleteItem = useCallback(
    (id: string) => {
      // Files F8: one door for every delete — F2's Confirm before delete (on or off), the bin, and the Undo bar.
      requestFilesDelete({
        ids: [id],
        source: 'player',
        name: enrichedCanonical.find((item) => item.id === id)?.displayName,
        onDone: (result) => {
          if (result.deleted.includes(id) || result.trashed.includes(id)) setActionItemId(null);
        },
      });
    },
    [enrichedCanonical],
  );

  const openDownloads = useCallback(() => {
    navigation.push(routePaths.downloads);
  }, []);

  const openWatchHistory = useCallback(() => {
    navigation.push(routePaths.watchHistory);
  }, []);

  // Previous / Next in the Player step through the library as shown (filter, search and sort applied).
  const openLibraryItem = useCallback(
    (id: string) => {
      openPlayer(id, visibleItems.map((item) => item.id));
    },
    [visibleItems],
  );

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
    openPlayer: openLibraryItem,
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
    // P9
    durationBucket,
    onSelectDuration,
    excludedFolderIds,
    // Folders that still exist (a deleted folder's id stays in the list but hides nothing).
    hiddenFolderCount: excludedFolderIds.filter((id) => id === UNFILED_FOLDER_SELECTION_ID || foldersById[id] != null)
      .length,
    folderVisibilityVisible,
    openFolderVisibility: () => setFolderVisibilityVisible(true),
    closeFolderVisibility: () => setFolderVisibilityVisible(false),
    playCounts,
  };
}
