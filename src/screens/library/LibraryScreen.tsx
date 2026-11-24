import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { ds, DsHeader, DsRow, DsRowGroup, DsScreen } from '@/design';
import { useTranslation } from '@/localization';
import { useShowInFolderSheetActions } from '@/screens/library/hooks/useShowInFolderSheetAction';
import { ConfirmModal } from '@/components/modals/ConfirmModal';

import {
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
import { countByKind, itemsOfKind, type LibraryKind } from './utils/library-kind';

export const LibraryScreen = memo(function LibraryScreen() {
  const { t } = useTranslation();
  // Design 18: Videos · Audio split the list.
  const [kind, setKind] = useState<LibraryKind>('video');
  const {
    visibleItems,
    searchDraft,
    filter,
    folderId,
    sort,
    viewMode,
    quality,
    qualities,
    controlsDirty,
    folderSelectionSheetVisible,
    sortSheetVisible,
    qualitySheetVisible,
    refreshing,
    status,
    error,
    onChangeSearch,
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

  // Design 18's "48 videos · 120 songs".
  const counts = countByKind(visibleItems);
  const subtitle =
    [
      counts.videos > 0
        ? counts.videos === 1
          ? t('playerDesign.countVideosOne')
          : t('playerDesign.countVideos', { count: counts.videos })
        : null,
      counts.audio > 0 ? t('playerDesign.countAudio', { count: counts.audio }) : null,
    ]
      .filter(Boolean)
      .join(' · ') || undefined;
  const shownItems = useMemo(() => itemsOfKind(visibleItems, kind), [kind, visibleItems]);

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

  const header = (
    <View style={{ paddingHorizontal: ds.space.screenX, gap: 10, marginBottom: 10 }}>
      <DsHeader title={t('library.title')} subtitle={subtitle} action={<PrivateHeaderButton />} testID="library-header" />
      <LibraryHeaderControls
        kind={kind}
        onSelectKind={setKind}
        onOpenPlaylists={() => navigation.push(routePaths.playlists)}
        onOpenNetwork={() => navigation.push(routePaths.networkStream)}
        searchDraft={searchDraft}
        filter={filter}
        sort={sort}
        viewMode={viewMode}
        quality={quality}
        qualities={qualities}
        controlsDirty={controlsDirty}
        sortSheetVisible={sortSheetVisible}
        qualitySheetVisible={qualitySheetVisible}
        onChangeSearch={onChangeSearch}
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
      />
    </View>
  );

  // Design 18's last card: Include / exclude folders, and the other ways to play (videos on the phone, a stream).
  const footer = (
    <DsRowGroup testID="library-more">
      <DsRow
        icon="sliders-horizontal"
        title={t('playerDesign.rowFolders')}
        value={hiddenFolderCount > 0 ? t('playerDesign.rowFoldersHidden', { count: hiddenFolderCount }) : undefined}
        onPress={openFolderVisibility}
        testID="library-folder-visibility"
      />
      <DsRow
        icon="smartphone"
        title={t('playerDesign.rowDeviceVideos')}
        subtitle={t('playerDesign.rowDeviceVideosSub')}
        onPress={() => navigation.push(routePaths.deviceVideos)}
        accessibilityLabel={t('deviceVideos.open')}
        testID="library-device-videos"
      />
      <DsRow
        icon="globe"
        title={t('playerDesign.rowNetwork')}
        onPress={() => navigation.push(routePaths.networkStream)}
        accessibilityLabel={t('playerEngine.streamOpenA11y')}
        testID="library-network-stream"
      />
    </DsRowGroup>
  );

  return (
    <DsScreen scroll={false} testID="library-screen">
      {status !== 'ready' ? header : null}
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
        <LibraryList
          items={shownItems}
          viewMode={viewMode}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onPressItem={playlists.selecting ? playlists.toggle : openPlayer}
          onLongPressItem={playlists.selecting ? playlists.toggle : openItemActions}
          selectedIds={playlists.selectedIds}
          listHeaderComponent={header}
          listFooterComponent={footer}
          listEmptyComponent={
            <EmptyState
              icon={kind === 'audio' ? 'music-note-outline' : 'video-outline'}
              title={kind === 'audio' ? t('playerDesign.emptyAudio') : t('library.emptyTitle')}
              description={kind === 'audio' ? t('playerDesign.emptyAudioHint') : undefined}
            />
          }
        />
      )}
      {status !== 'ready' && status !== 'loading' ? (
        <View style={{ paddingHorizontal: ds.space.screenX, paddingBottom: 16 }}>{footer}</View>
      ) : null}
    </DsScreen>
  );
});
