import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { RefreshControl, useWindowDimensions, View, type FlatList, type ListRenderItem } from 'react-native';

import { ds, type DsIconName } from '@/design';
import { displayFileName } from '@/files/ui/display-name';
import type { FileEntry, FolderEntry } from '@/files/ui/files-index';
import { GRID_COLUMNS, LIST_THUMBNAIL_DP, useFilesViewSettings } from '@/files/ui/files-view-settings';
import { useTheme } from '@/hooks/use-theme';
import { intlLocaleForLanguage, useTranslation } from '@/localization';

import { fileMetaLine, fileTypeIcon, type FolderListEntry } from '../utils/file-rows';
import { DragSelectList } from './DragSelectList';
import { FileRow } from './FileRow';
import { FolderRow } from './FolderRow';
import { GridTile } from './GridTile';
import { SelectRow } from './SelectRow';

/** F4: the list's selection (entry keys: `file:<id>` / `folder:<id>`). */
export type EntriesSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  toggle: (key: string) => void;
  startWith: (key: string) => void;
  dragStart: (index: number) => void;
  dragOver: (index: number) => void;
  dragEnd: () => void;
};

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
  /** F4: a long press starts selecting (and a drag selects a range); while selecting a tap toggles. */
  selection?: EntriesSelection;
  testID?: string;
};

/**
 * Files F1/F2/F4: a Files list of folders and files in one FlatList, drawn as F2's settings say — rows or the grid
 * (4 / 3 / 2 columns), thumbnails or type icons at the chosen size, names with or without their extension. Any change
 * on the File manager settings page redraws it at once. With a selection (F4) a long press starts selecting, and
 * keeping the finger down and dragging selects a range (`DragSelectList`); while selecting, rows show their check box.
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
  selection,
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
  const thumbnailSize = LIST_THUMBNAIL_DP[settings.thumbnailSize];
  const nameOf = useCallback((file: FileEntry) => displayFileName(file.name, settings.showExtensions), [settings.showExtensions]);
  const selecting = selection?.active === true;

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
      if (selecting && selection) {
        const isFolder = item.kind === 'folder';
        return (
          <SelectRow
            title={isFolder ? item.folder.name : nameOf(item.file)}
            meta={isFolder ? folderMeta(item.folder) : fileMetaLine(item.file, locale)}
            icon={isFolder ? (folderIcon?.(item.folder) ?? 'folder') : fileTypeIcon(item.file.type)}
            pictureUri={!isFolder && settings.showThumbnails ? item.file.thumbnailUri : null}
            thumbnailSize={thumbnailSize}
            selected={selection.selected.has(item.key)}
            onToggle={() => selection.toggle(item.key)}
            first={first}
            last={last}
            testID={`files-select-${item.key}`}
          />
        );
      }
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
          thumbnailSize={thumbnailSize}
          first={first}
          last={last}
          onPress={onPressFile}
          onMore={onMoreFile}
          // F4: a long press selects (the gesture of DragSelectList); ⋮ keeps the actions sheet. TalkBack gets "Select".
          longPressOpensMore={!selection}
          onSelect={selection ? () => selection.startWith(item.key) : undefined}
          highlighted={item.file.id === highlightId}
          testID={`files-file-${item.file.id}`}
        />
      );
    },
    [entries.length, folderIcon, folderMeta, highlightId, locale, nameOf, onMoreFile, onMoreFolder, onPressFile, onPressFolder, selecting, selection, settings.showThumbnails, thumbnailSize],
  );

  const renderTile = useCallback<ListRenderItem<FolderListEntry>>(
    ({ item }) => {
      const selected = selecting && selection ? selection.selected.has(item.key) : undefined;
      const toggle = selecting && selection ? () => selection.toggle(item.key) : undefined;
      return item.kind === 'folder' ? (
        <GridTile
          title={item.folder.name}
          meta={folderMeta(item.folder)}
          icon={folderIcon?.(item.folder) ?? 'folder'}
          width={tileWidth}
          onPress={toggle ?? (() => onPressFolder(item.folder))}
          onLongPress={!selection && onMoreFolder ? () => onMoreFolder(item.folder) : undefined}
          selected={selected}
          accessibilityHint={selected === undefined ? t('fileManager.folderOpenHint') : t('fileManager.selectHint')}
          testID={`files-folder-${item.folder.id}`}
        />
      ) : (
        <GridTile
          title={nameOf(item.file)}
          meta={fileMetaLine(item.file, locale)}
          icon={fileTypeIcon(item.file.type)}
          pictureUri={settings.showThumbnails ? item.file.thumbnailUri : null}
          width={tileWidth}
          onPress={toggle ?? (() => onPressFile(item.file))}
          onLongPress={!selection && onMoreFile ? () => onMoreFile(item.file) : undefined}
          selected={selected}
          accessibilityHint={selected === undefined ? t('fileManager.fileOpenHint') : t('fileManager.selectHint')}
          testID={`files-file-${item.file.id}`}
        />
      );
    },
    [folderIcon, folderMeta, locale, nameOf, onMoreFile, onMoreFolder, onPressFile, onPressFolder, selecting, selection, settings.showThumbnails, t, tileWidth],
  );

  const noop = useCallback(() => undefined, []);

  return (
    <DragSelectList
      // A new column count needs a new list (FlatList can't change `numColumns` on the fly).
      key={grid ? `grid-${columns}` : 'list'}
      listRef={listRef}
      data={entries}
      keyExtractor={(entry) => entry.key}
      renderItem={grid ? renderTile : renderRow}
      numColumns={columns}
      columns={columns}
      rowGap={grid ? ds.space.grid : 0}
      paddingX={ds.space.screenX}
      dragEnabled={Boolean(selection)}
      onDragStart={selection?.dragStart ?? noop}
      onDragOver={selection?.dragOver ?? noop}
      onDragEnd={selection?.dragEnd ?? noop}
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
      extraData={[settings, selection?.selected, selecting]}
      onScrollToIndexFailed={({ averageItemLength, index }) => listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true })}
      testID={testID}
    />
  );
});

function GridGap() {
  return <View style={{ height: ds.space.grid }} />;
}
