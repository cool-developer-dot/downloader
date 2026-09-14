import { memo, useCallback } from 'react';
import { SectionList, type SectionListRenderItem } from 'react-native';

import type { BrowserHistoryEntry } from '@/storage/types';

import type { HistoryListSection } from '../utils/history-format';
import { HistoryFooterLoader } from './HistoryFooterLoader';
import { HistoryItem } from './HistoryItem';
import { HistorySectionHeader } from './HistorySection';

export type HistoryListProps = {
  sections: HistoryListSection[];
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  onPressItem: (item: BrowserHistoryEntry) => void;
  onDeleteItem: (item: BrowserHistoryEntry) => void;
  testID?: string;
};

export const HistoryList = memo(function HistoryList({
  sections,
  refreshing,
  loadingMore,
  hasMore,
  onRefresh,
  onEndReached,
  onPressItem,
  onDeleteItem,
  testID = 'history-list',
}: HistoryListProps) {
  const renderItem: SectionListRenderItem<BrowserHistoryEntry, HistoryListSection> =
    useCallback(
      ({ item }) => (
        <HistoryItem
          item={item}
          onPress={onPressItem}
          onDelete={onDeleteItem}
          testID={`history-item-${item.id}`}
        />
      ),
      [onDeleteItem, onPressItem],
    );

  const renderSectionHeader = useCallback(
    ({ section }: { section: HistoryListSection }) => (
      <HistorySectionHeader
        title={section.title}
        testID={`history-section-${section.key}`}
      />
    ),
    [],
  );

  const keyExtractor = useCallback((item: BrowserHistoryEntry) => item.id, []);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && hasMore) {
      onEndReached();
    }
  }, [hasMore, loadingMore, onEndReached]);

  return (
    <SectionList
      testID={testID}
      sections={sections}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      stickySectionHeadersEnabled
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={16}
      maxToRenderPerBatch={16}
      windowSize={8}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={
        <HistoryFooterLoader
          loading={loadingMore}
          hasMore={hasMore}
          visible={sections.length > 0}
        />
      }
      contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      accessibilityRole="list"
    />
  );
});
