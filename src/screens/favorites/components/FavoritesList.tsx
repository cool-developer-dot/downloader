import { memo, useCallback, useMemo } from 'react';
import { FlatList, type ListRenderItem } from 'react-native';

import { useFavoritesStore } from '@/store/favorites';
import type { FavoriteItem as FavoriteEntry } from '@/store/favorites';

import { FavoriteFooterLoader } from './FavoriteFooterLoader';
import { FavoriteItem } from './FavoriteItem';

export type FavoritesListProps = {
  orderedIds: string[];
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  unavailableIds: Record<string, boolean>;
  onRefresh: () => void;
  onEndReached: () => void;
  onPressItem: (item: FavoriteEntry) => void;
  onRemoveItem: (item: FavoriteEntry) => void;
  testID?: string;
};

const FavoriteRow = memo(function FavoriteRow({
  id,
  unavailable,
  onPress,
  onRemove,
}: {
  id: string;
  unavailable: boolean;
  onPress: (item: FavoriteEntry) => void;
  onRemove: (item: FavoriteEntry) => void;
}) {
  const item = useFavoritesStore((state) => state.itemsById[id]);
  const removing = useFavoritesStore((state) => Boolean(state.mutatingIds[id]));

  if (!item) {
    return null;
  }

  return (
    <FavoriteItem
      item={item}
      unavailable={unavailable}
      removing={removing}
      onPress={onPress}
      onRemove={onRemove}
      testID={`favorite-item-${id}`}
    />
  );
});

export const FavoritesList = memo(function FavoritesList({
  orderedIds,
  refreshing,
  loadingMore,
  hasMore,
  unavailableIds,
  onRefresh,
  onEndReached,
  onPressItem,
  onRemoveItem,
  testID = 'favorites-list',
}: FavoritesListProps) {
  const renderItem: ListRenderItem<string> = useCallback(
    ({ item: id }) => (
      <FavoriteRow
        id={id}
        unavailable={Boolean(unavailableIds[id])}
        onPress={onPressItem}
        onRemove={onRemoveItem}
      />
    ),
    [onPressItem, onRemoveItem, unavailableIds],
  );

  const keyExtractor = useCallback((id: string) => id, []);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && hasMore) {
      onEndReached();
    }
  }, [hasMore, loadingMore, onEndReached]);

  const listEmpty = useMemo(() => null, []);

  return (
    <FlatList
      testID={testID}
      data={orderedIds}
      keyExtractor={keyExtractor}
      extraData={unavailableIds}
      renderItem={renderItem}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={14}
      maxToRenderPerBatch={14}
      windowSize={8}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={listEmpty}
      ListFooterComponent={
        <FavoriteFooterLoader
          loading={loadingMore}
          hasMore={hasMore}
          visible={orderedIds.length > 0}
        />
      }
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      accessibilityRole="list"
    />
  );
});
