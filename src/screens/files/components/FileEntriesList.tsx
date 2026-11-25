import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { FlatList, RefreshControl, useWindowDimensions, View, type ListRenderItem } from 'react-native';

import { ds, type DsIconName } from '@/design';
import { displayFileName } from '@/files/ui/display-name';
import type { FileEntry, FolderEntry } from '@/files/ui/files-index';
import { GRID_COLUMNS, LIST_THUMBNAIL_DP, useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';

import { fileMetaLine, fileTypeIcon, type FolderListEntry } from '../utils/file-rows';
import { FileRow } from './FileRow';
import { FolderRow } from './FolderRow';
import { GridTile } from './GridTile';

export type FileEntriesListProps = {
  entries: readonly FolderListEntry[];
  header: ReactElement;
  empty: ReactElement | null;
  /** A folder row's "{n} items · {size}". */
  folderMeta: (folder: FolderEntry) => string;
  onPressFile: (file: FileEntry) => void;
  onMoreFile?: (file: FileEntry) => void;
  onPressFolder: (folder: FolderEntry) => void;
  onMoreFolder?: (folder: FolderEntry) => void;
  /** A folder's tile icon (F10 draws a locked folder with the lock). */
  folderIcon?: (folder: FolderEntry) => DsIconName;
  refreshing: boolean;
  onRefresh: () => void;
  /** F3 Show in folder: this file's row is highlighted and scrolled to once. */
  highlightId?: string;
  testID?: string;
};

/**
 * Files F1/F2: a Files list of folders and files in one FlatList, drawn as F2's settings say — rows or the grid
 * (4 / 3 / 2 columns), thumbnails or type icons at the chosen size, names with or without their extension. Any change
 * on the File manager settings page redraws it at once.
 */
export const FileEntriesList = memo(function FileEntriesList({
  entries,
  header,
  empty,
  folderMeta,
  onPressFile,
  onMoreFile,
  onPressFolder,
  onMoreFolder,
  folderIcon,
  refreshing,
  onRefresh,
  highlightId,
  testID = 'files-entries',
}: FileEntriesListProps) {
  const theme = useTheme();
  const { t, language, rtl } = useTranslation();
  const { width } = useWindowDimensions();
  const settings = useFilesViewSettings();
  const locale = intlLocaleForLanguage(language);
  const grid = settings.viewMode === 'grid';
  const columns = grid ? GRID_COLUMNS[settings.thumbnailSize] : 1;
  const tileWidth = Math.floor((width - ds.space.screenX * 2 - ds.space.grid * (columns - 1)) / columns);
  const nameOf = useCallback((file: FileEntry) => displayFileName(file.name, settings.showExtensions), [settings.showExtensions]);

  // F3 Show in folder: scroll the highlighted file into view once its row is in the list.
  const listRef = useRef<FlatList<FolderListEntry>>(null);
  const scrolledToRef = useRef<string | null>(null);
  const highlightIndex = highlightId ? entries.findIndex((entry) => entry.kind === 'file' && entry.file.id === highlightId) : -1;
  useEffect(() => {
    if (!highlightId || highlightIndex < 0 || scrolledToRef.current === highlightId) {
      return undefined;
    }
    scrolledToRef.current = highlightId;
    const timer = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: Math.floor(highlightIndex / columns), viewPosition: 0.3, animated: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [columns, highlightId, highlightIndex]);

  const renderRow = useCallback<ListRenderItem<FolderListEntry>>(
    ({ item, index }) => {
      const first = index === 0;
      const last = index === entries.length - 1;
      if (item.kind === 'folder') {
        return (
          <FolderRow
            folder={item.folder}
            meta={folderMeta(item.folder)}
            first={first}
            last={last}
            onPress={onPressFolder}
            onMore={onMoreFolder}
            icon={folderIcon?.(item.folder)}
            testID={`files-folder-${item.folder.id}`}
          />
        );
      }
      return (
        <FileRow
          file={item.file}
          name={nameOf(item.file)}
          meta={fileMetaLine(item.file, locale)}
          showThumbnail={settings.showThumbnails}
          thumbnailSize={LIST_THUMBNAIL_DP[settings.thumbnailSize]}
          first={first}
          last={last}
          onPress={onPressFile}
          onMore={onMoreFile}
          highlighted={item.file.id === highlightId}
          testID={`files-file-${item.file.id}`}
        />
      );
    },
    [entries.length, folderIcon, folderMeta, highlightId, locale, nameOf, onMoreFile, onMoreFolder, onPressFile, onPressFolder, settings.showThumbnails, settings.thumbnailSize],
  );

  const renderTile = useCallback<ListRenderItem<FolderListEntry>>(
    ({ item }) =>
      item.kind === 'folder' ? (
        <GridTile
          title={item.folder.name}
          meta={folderMeta(item.folder)}
          icon={folderIcon?.(item.folder) ?? 'folder'}
          width={tileWidth}
          onPress={() => onPressFolder(item.folder)}
          onLongPress={onMoreFolder ? () => onMoreFolder(item.folder) : undefined}
          accessibilityHint={t('fileManager.folderOpenHint')}
          testID={`files-folder-${item.folder.id}`}
        />
      ) : (
        <GridTile
          title={nameOf(item.file)}
          meta={fileMetaLine(item.file, locale)}
          icon={fileTypeIcon(item.file.type)}
          pictureUri={settings.showThumbnails ? item.file.thumbnailUri : null}
          width={tileWidth}
          onPress={() => onPressFile(item.file)}
          onLongPress={onMoreFile ? () => onMoreFile(item.file) : undefined}
          accessibilityHint={t('fileManager.fileOpenHint')}
          testID={`files-file-${item.file.id}`}
        />
      ),
    [folderIcon, folderMeta, locale, nameOf, onMoreFile, onMoreFolder, onPressFile, onPressFolder, settings.showThumbnails, t, tileWidth],
  );

  return (
    <FlatList
      ref={listRef}
      // A new column count needs a new list (FlatList can't change `numColumns` on the fly).
      key={grid ? `grid-${columns}` : 'list'}
      data={entries}
      keyExtractor={(entry) => entry.key}
      renderItem={grid ? renderTile : renderRow}
      numColumns={columns}
      columnWrapperStyle={grid ? { gap: ds.space.grid, flexDirection: rtl.rowDirection } : undefined}
      ItemSeparatorComponent={grid ? GridGap : undefined}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={{ paddingHorizontal: ds.space.screenX, paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
          accessibilityLabel={t('common.refreshA11y')}
        />
      }
      extraData={settings}
      onScrollToIndexFailed={({ averageItemLength, index }) =>
        listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true })
      }
      testID={testID}
    />
  );
});

function GridGap() {
  return <View style={{ height: ds.space.grid }} />;
}
