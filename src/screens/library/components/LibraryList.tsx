import { memo, useCallback, useMemo, type ReactElement } from 'react';
import {
  FlatList,
  useWindowDimensions,
  type ListRenderItem,
} from 'react-native';

import { Box } from '@/components/base/Box';
import type { LibraryViewMode, MediaLibraryItem } from '@/library';

import { useLibraryTokens } from '../theme/library-tokens';
import { LibraryCard } from './LibraryCard';
import { LibraryGridTile } from './LibraryGridTile';

export type LibraryListProps = {
  items: MediaLibraryItem[];
  viewMode: LibraryViewMode;
  refreshing: boolean;
  onRefresh: () => void;
  onPressItem: (id: string) => void;
  onLongPressItem?: (id: string) => void;
  listEmptyComponent?: ReactElement | null;
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
  listEmptyComponent,
  testID = 'library-list',
}: LibraryListProps) {
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
      <LibraryCard
        item={item}
        onPress={onPressItem}
        onLongPress={onLongPressItem}
        testID={`library-card-${item.id}`}
      />
    ),
    [onLongPressItem, onPressItem],
  );

  const renderGridItem: ListRenderItem<MediaLibraryItem> = useCallback(
    ({ item }) => (
      <LibraryGridTile
        item={item}
        width={tileWidth}
        onPress={onPressItem}
        onLongPress={onLongPressItem}
        testID={`library-tile-${item.id}`}
      />
    ),
    [onLongPressItem, onPressItem, tileWidth],
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
      extraData={viewMode}
      refreshing={refreshing}
      onRefresh={onRefresh}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        flexGrow: 1,
        paddingBottom: 24,
        paddingTop: 4,
      }}
      ListEmptyComponent={listEmptyComponent}
      ListFooterComponent={
        items.length > 0 ? <Box style={{ height: 16 }} /> : null
      }
      initialNumToRender={isGrid ? 8 : 12}
      maxToRenderPerBatch={isGrid ? 6 : 10}
      windowSize={5}
      removeClippedSubviews
      getItemLayout={
        isGrid
          ? undefined
          : (_data, index) => ({
              length: libraryTokens.listRowHeight,
              offset: libraryTokens.listRowHeight * index,
              index,
            })
      }
    />
  );
});
