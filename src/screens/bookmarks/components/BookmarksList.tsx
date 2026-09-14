import { memo, useCallback, useMemo } from 'react';
import { FlatList, type ListRenderItem } from 'react-native';

import type { BookmarkEntry } from '@/storage/types';

import { BookmarkFooterLoader } from './BookmarkFooterLoader';
import { BookmarkItem } from './BookmarkItem';

export type BookmarksListProps = {
  items: BookmarkEntry[];
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  onPressItem: (item: BookmarkEntry) => void;
  onDeleteItem: (item: BookmarkEntry) => void;
  testID?: string;
};

export const BookmarksList = memo(function BookmarksList({
  items,
  refreshing,
  loadingMore,
  hasMore,
  onRefresh,
  onEndReached,
  onPressItem,
  onDeleteItem,
  testID = 'bookmarks-list',
}: BookmarksListProps) {
  const renderItem: ListRenderItem<BookmarkEntry> = useCallback(
    ({ item }) => (
      <BookmarkItem
        item={item}
        onPress={onPressItem}
        onDelete={onDeleteItem}
        testID={`bookmark-item-${item.id}`}
      />
    ),
    [onDeleteItem, onPressItem],
  );

  const keyExtractor = useCallback((item: BookmarkEntry) => item.id, []);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && hasMore) {
      onEndReached();
    }
  }, [hasMore, loadingMore, onEndReached]);

  const listEmpty = useMemo(() => null, []);

  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      windowSize={8}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={listEmpty}
      ListFooterComponent={
        <BookmarkFooterLoader
          loading={loadingMore}
          hasMore={hasMore}
          visible={items.length > 0}
        />
      }
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      accessibilityRole="list"
    />
  );
});
