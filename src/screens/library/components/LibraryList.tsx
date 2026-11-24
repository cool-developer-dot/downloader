import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import {
  FlatList,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';

import { ds } from '@/design';
import type { LibraryViewMode, MediaLibraryItem } from '@/library';
import { useTagFilteredItems } from '@/screens/downloads/hooks/useOrganizeNarrowing';

import { useLibraryTokens } from '../theme/library-tokens';
import { LibraryGridTile } from './LibraryGridTile';
import { LibraryRowCard } from './LibraryRowCard';

export type LibraryListProps = {
  items: MediaLibraryItem[];
  viewMode: LibraryViewMode;
  refreshing: boolean;
  onRefresh: () => void;
  onPressItem: (id: string) => void;
  onLongPressItem?: (id: string) => void;
  /** P7 selection mode: the selected ids while selecting (undefined otherwise). */
  selectedIds?: ReadonlySet<string>;
  listEmptyComponent?: ReactElement | null;
  /** Design 18: the header and chips scroll with the videos; the folder / stream rows follow the last one. */
  listHeaderComponent?: ReactElement | null;
  listFooterComponent?: ReactElement | null;
  testID?: string;
};

const GRID_COLUMNS = 2;

export const LibraryList = memo(function LibraryList({
  items,
  viewMode,
  refreshing,
  onRefresh,
  onPressItem,
  onLongPressItem,
  selectedIds,
  listEmptyComponent,
  listHeaderComponent,
  listFooterComponent,
  testID = 'library-list',
}: LibraryListProps) {
  // H12 (#387): the Tag filter narrows the videos shown (no tag chosen = every video, as before).
  items = useTagFilteredItems(items);
  const libraryTokens = useLibraryTokens();
  const { width } = useWindowDimensions();
  const isGrid = viewMode === 'grid';
  const horizontalPadding = libraryTokens.spacing.screenX * 2;
  const gap = libraryTokens.spacing.gridGap;
  const tileWidth = Math.floor(
    (width - horizontalPadding - gap) / GRID_COLUMNS,
  );

  const renderListItem: ListRenderItem<MediaLibraryItem> = useCallback(
    ({ item }) => (
      <View style={{ paddingHorizontal: ds.space.screenX }}>
        <LibraryRowCard
          item={item}
          onPress={onPressItem}
          onMore={onLongPressItem}
          selected={selectedIds ? selectedIds.has(item.id) : undefined}
          testID={`library-card-${item.id}`}
        />
      </View>
    ),
    [onLongPressItem, onPressItem, selectedIds],
  );

  const renderGridItem: ListRenderItem<MediaLibraryItem> = useCallback(
    ({ item }) => (
      <LibraryGridTile
        item={item}
        width={tileWidth}
        onPress={onPressItem}
        onLongPress={onLongPressItem}
        selected={selectedIds ? selectedIds.has(item.id) : undefined}
        testID={`library-tile-${item.id}`}
      />
    ),
    [onLongPressItem, onPressItem, selectedIds, tileWidth],
  );

  const keyExtractor = useCallback((item: MediaLibraryItem) => item.id, []);

  const columnWrapperStyle = useMemo(
    () =>
      isGrid
        ? {
            paddingHorizontal: libraryTokens.spacing.screenX,
            gap,
            marginBottom: gap,
          }
        : undefined,
    [gap, isGrid],
  );

  return (
    <FlatList
      testID={testID}
      data={items}
      key={isGrid ? 'library-grid' : 'library-list'}
      keyExtractor={keyExtractor}
      renderItem={isGrid ? renderGridItem : renderListItem}
      numColumns={isGrid ? GRID_COLUMNS : 1}
      columnWrapperStyle={columnWrapperStyle}
      extraData={selectedIds ?? viewMode}
      refreshing={refreshing}
      onRefresh={onRefresh}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: 24,
        paddingTop: 0,
      }}
      ListEmptyComponent={listEmptyComponent}
      ListHeaderComponent={listHeaderComponent}
      ListFooterComponent={
        <View style={{ paddingHorizontal: ds.space.screenX, paddingTop: items.length > 0 ? 2 : 0, paddingBottom: 16 }}>
          {listFooterComponent}
        </View>
      }
      initialNumToRender={isGrid ? 8 : 12}
      maxToRenderPerBatch={isGrid ? 6 : 10}
      windowSize={5}
      removeClippedSubviews
    />
  );
});
