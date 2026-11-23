import { memo, useCallback, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useShowInFolderSheetActions } from '@/screens/library/hooks/useShowInFolderSheetAction';
import { ConfirmModal } from '@/components/modals/ConfirmModal';

import {
  ContinueWatchingSection,
  LibraryEmptyState,
  LibraryErrorState,
  LibraryHeaderControls,
  LibraryList,
  LibrarySkeleton,
} from './components';
import { navigation, routePaths } from '@/navigation';

import { useLibraryScreen } from './hooks/useLibraryScreen';
import { useWithSaveThumbnailAction } from './hooks/useSaveThumbnailSheetAction';
import { ActionSheetModal } from '@/components/bottom-sheets/ActionSheetModal';
import type { ActionSheetItem } from '@/components/bottom-sheets/ActionSheet';
import { UNFILED_FOLDER_SELECTION_ID } from '@/library/constants';
import { useTagSheetActions } from '@/screens/downloads/hooks/useTagSheetActions';
import { useFoldersStore } from '@/store/organization/folders';
import { EmptyState } from '@/components/common/EmptyState';
import { usePrivateMoveSheet } from '@/screens/library/hooks/usePrivateMoveSheet';
import { useQueueSheetActions } from '@/screens/library/hooks/useQueueSheetActions';
import { PrivateHeaderButton } from '@/screens/private/PrivateHeaderButton';
import { PrivateMoveDialog } from '@/screens/private/PrivateMoveDialog';
// P7 Playlists: the item menu's Add to playlist / Select, the selection mode, the add sheet.
import { AddToPlaylistSheet } from '@/screens/playlists/components/AddToPlaylistSheet';
import { LibrarySelectionBar } from './components/LibrarySelectionBar';
import { useLibraryPlaylists } from './hooks/useLibraryPlaylists';
// P9 #628: Filter → Include / exclude folders.
import { LibraryFolderVisibilitySheet } from './components/LibraryFolderVisibilitySheet';

export const LibraryScreen = memo(function LibraryScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    visibleItems,
    continueWatchingItems,
    playableCount,
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
    status,
    error,
    onChangeSearch,
    openFilterSheet,
    closeFilterSheet,
    closeFolderSelection,
    onSelectFolderSelection,
    openSortSheet,
    closeSortSheet,
    openQualitySheet,
    closeQualitySheet,
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
    durationBucket,
    onSelectDuration,
    excludedFolderIds,
    hiddenFolderCount,
    folderVisibilityVisible,
    openFolderVisibility,
    closeFolderVisibility,
    playCounts,
  } = useLibraryScreen();
  const showInFolderActionsFor = useShowInFolderSheetActions();

  const foldersById = useFoldersStore((s) => s.itemsById);
  const tagActionsFor = useTagSheetActions();
  // P6 #620: Play next / Add to queue, while a video is open in the Player or the mini player.
  const queueActionsFor = useQueueSheetActions();
  const folderOrderedIds = useFoldersStore((s) => s.orderedIds);
  const { privateMoveActionsFor, privateMove } = usePrivateMoveSheet();
  const playlists = useLibraryPlaylists(visibleItems);
  const playlistActionsFor = playlists.actionsFor;

  const completedActions = useMemo<ActionSheetItem[]>(() => {
    if (!actionItemId) {
      return [];
    }
    const id = actionItemId;
    return [
      {
        id: 'open',
        label: t('library.openWith'),
        onPress: () => {
          closeItemActions();
          void openItemExternal(id);
        },
      },
      ...queueActionsFor(
        id,
        visibleItems.find((item) => item.id === id)?.displayName ?? null,
        closeItemActions,
      ),
      ...tagActionsFor(id, closeItemActions),
      ...playlistActionsFor(id, closeItemActions),
      {
        id: 'share',
        label: t('library.share'),
        onPress: () => {
          closeItemActions();
          void shareItem(id);
        },
      },
      ...showInFolderActionsFor(id, closeItemActions),
      {
        id: 'save',
        label: t('library.saveToDevice'),
        onPress: () => {
          closeItemActions();
          void saveItemToDevice(id);
        },
      },
      ...privateMoveActionsFor(id, closeItemActions),
      {
        id: 'delete',
        label: t('library.deleteFromVidoraX'),
        onPress: () => {
          closeItemActions();
          requestDeleteItem(id);
        },
      },
    ];
  }, [
    actionItemId,
    closeItemActions,
    showInFolderActionsFor,
    openItemExternal,
    playlistActionsFor,
    privateMoveActionsFor,
    queueActionsFor,
    requestDeleteItem,
    saveItemToDevice,
    tagActionsFor,
    visibleItems,
    shareItem,
    t,
  ]);
  const completedActionsWithThumbnail = useWithSaveThumbnailAction(completedActions, actionItemId, closeItemActions);

  const folderSelectionActions = useMemo<ActionSheetItem[]>(
    () => {
      const actions: ActionSheetItem[] = [
        {
          id: UNFILED_FOLDER_SELECTION_ID,
          label:
            filter === 'folder' && folderId === UNFILED_FOLDER_SELECTION_ID
              ? 'Unfiled / Downloads ✓'
              : 'Unfiled / Downloads',
          onPress: () => onSelectFolderSelection(UNFILED_FOLDER_SELECTION_ID),
        },
      ];

      for (const id of folderOrderedIds) {
        const folder = foldersById[id];
        if (!folder) continue;
        const selected = filter === 'folder' && folderId === id;
        actions.push({
          id,
          label: selected ? `${folder.name} ✓` : folder.name,
          onPress: () => onSelectFolderSelection(id),
        });
      }

      return actions;
    },
    [filter, folderId, folderOrderedIds, foldersById, onSelectFolderSelection],
  );

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const subtitle =
    playableCount > 0
      ? `${playableCount} video${playableCount === 1 ? '' : 's'}`
      : undefined;

  // P9 #708: how many times the video was played, after the menu's usual line.
  const actionPlays = actionItemId ? (playCounts[actionItemId]?.playCount ?? 0) : 0;
  const actionSubtitle = actionError
    ? actionError
    : actionStatusMessage === 'saved'
      ? t('library.savedToDevice')
      : actionStatusMessage === 'already_saved'
        ? t('library.alreadySavedToDevice')
        : actionPlays > 0
          ? `${t('library.actionsSubtitle')} · ${
              actionPlays === 1 ? t('libraryStats.playedOnce') : t('libraryStats.playedTimes', { count: actionPlays })
            }`
          : t('library.actionsSubtitle');

  const folderList = useMemo(
    () =>
      folderOrderedIds
        .map((id) => foldersById[id])
        .filter((folder): folder is NonNullable<typeof folder> => folder != null)
        .map((folder) => ({ id: folder.id, name: folder.name })),
    [folderOrderedIds, foldersById],
  );

  return (
    <SafeAreaScreen
      testID="library-screen"
      padded={false}
      edges={['top', 'left', 'right', 'bottom']}
      style={{ backgroundColor: theme.colors.background }}>
      <ScreenHeader
        title={t('library.title')}
        subtitle={subtitle}
        actions={
          <>
          <Pressable
            testID="library-device-videos"
            accessibilityRole="button"
            accessibilityLabel={t('deviceVideos.open')}
            onPress={() => navigation.push(routePaths.deviceVideos)}
            hitSlop={8}
            style={{ padding: 8 }}>
            <Icon name="cellphone-play" size="md" color="headerIcon" />
          </Pressable>
          <Pressable
            testID="library-network-stream"
            accessibilityRole="button"
            accessibilityLabel={t('playerEngine.streamOpenA11y')}
            onPress={() => navigation.push(routePaths.networkStream)}
            hitSlop={8}
            style={{ padding: 8 }}>
            <Icon name="play-network-outline" size="md" color="headerIcon" />
          </Pressable>
          <Pressable
            testID="library-playlists"
            accessibilityRole="button"
            accessibilityLabel={t('playlists.open')}
            onPress={() => navigation.push(routePaths.playlists)}
            hitSlop={8}
            style={{ padding: 8 }}>
            <Icon name="playlist-play" size="md" color="headerIcon" />
          </Pressable>
          <PrivateHeaderButton />
          </>
        }
        testID="library-header"
      />

      <Box py={12} gap={4}>
        <LibraryHeaderControls
          searchDraft={searchDraft}
          filter={filter}
          sort={sort}
          viewMode={viewMode}
          quality={quality}
          qualities={qualities}
          controlsDirty={controlsDirty}
          filterSheetVisible={filterSheetVisible}
          sortSheetVisible={sortSheetVisible}
          qualitySheetVisible={qualitySheetVisible}
          onChangeSearch={onChangeSearch}
          onOpenFilter={openFilterSheet}
          onCloseFilter={closeFilterSheet}
          onOpenSort={openSortSheet}
          onCloseSort={closeSortSheet}
          onOpenQuality={openQualitySheet}
          onCloseQuality={closeQualitySheet}
          onSelectFilter={onSelectFilter}
          onSelectSort={onSelectSort}
          onSelectQuality={onSelectQuality}
          onToggleViewMode={onToggleViewMode}
          onReset={onReset}
          durationBucket={durationBucket}
          onSelectDuration={onSelectDuration}
          onOpenFolderVisibility={openFolderVisibility}
          hiddenFolderCount={hiddenFolderCount}
        />
      </Box>
      {playlists.selecting ? (
        <LibrarySelectionBar count={playlists.selectedCount} onAdd={playlists.addSelected} onCancel={playlists.cancel} />
      ) : null}

      <ActionSheetModal
        visible={folderSelectionSheetVisible}
        onClose={closeFolderSelection}
        title="Folders"
        subtitle="Show videos from one folder"
        actions={folderSelectionActions}
        testID="library-folder-selection"
      />

      <ActionSheetModal
        visible={actionSheetVisible}
        onClose={closeItemActions}
        title={t('library.actionsTitle')}
        subtitle={actionSubtitle}
        actions={completedActionsWithThumbnail}
        testID="library-completed-actions"
      />

      <ConfirmModal
        visible={deleteConfirmId != null}
        variant="delete"
        title={t('library.deleteTitle')}
        message={t('library.deleteMessage')}
        confirmLabel={t('library.deleteConfirm')}
        cancelLabel={t('library.deleteCancel')}
        onConfirm={() => {
          void confirmDeleteItem();
        }}
        onCancel={cancelDeleteItem}
        loading={deleteLoading}
        testID="library-delete-dialog"
      />
      <PrivateMoveDialog controller={privateMove} testID="library-private-move" />
      <AddToPlaylistSheet inputs={playlists.sheetInputs} onClose={playlists.closeSheet} onAdded={playlists.onAdded} />
      <LibraryFolderVisibilitySheet
        visible={folderVisibilityVisible}
        folders={folderList}
        excludedFolderIds={excludedFolderIds}
        onClose={closeFolderVisibility}
      />

      {status === 'loading' ? (
        <LibrarySkeleton />
      ) : status === 'error' ? (
        <LibraryErrorState
          message={error ?? 'Something went wrong while loading your library.'}
          onRetry={handleRefresh}
          refreshing={refreshing}
        />
      ) : status === 'empty' ? (
        <LibraryEmptyState
          variant="default"
          onActionPress={openDownloads}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : status === 'empty-search' ? (
        <LibraryEmptyState
          variant="search"
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      ) : status === 'empty-filter' ? (
        filter === 'recently_watched' ? (
          <EmptyState
            icon="history"
            title={t('library.emptyRecentlyWatchedTitle')}
            description={t('library.emptyRecentlyWatchedDescription')}
          />
        ) : filter === 'favorites' ? (
          <EmptyState
            icon="heart-outline"
            title={t('library.emptyFavoritesTitle')}
            description={t('library.emptyFavoritesDescription')}
          />
        ) : filter === 'folder' ? (
          <EmptyState
            icon="folder-outline"
            title={t('library.emptyFolderTitle')}
            description={t('library.emptyFolderDescription')}
          />
        ) : (
          <LibraryEmptyState
            variant="filter"
            refreshing={refreshing}
            onRefresh={handleRefresh}
          />
        )
      ) : (
        <Box style={{ flex: 1 }}>
          {filter === 'all' && !searchDraft.trim() ? (
            <ContinueWatchingSection
              items={continueWatchingItems}
              onSeeAll={openWatchHistory}
            />
          ) : null}
          <LibraryList
            items={visibleItems}
            viewMode={viewMode}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            onPressItem={playlists.selecting ? playlists.toggle : openPlayer}
            onLongPressItem={playlists.selecting ? playlists.toggle : openItemActions}
            selectedIds={playlists.selectedIds}
          />
        </Box>
      )}
    </SafeAreaScreen>
  );
});
