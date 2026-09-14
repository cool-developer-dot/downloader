import { memo, useCallback, useMemo } from 'react';
import {
  FlatList,
  SectionList,
  type ListRenderItem,
  type SectionListRenderItem,
} from 'react-native';

import type { DownloadListSection } from '../utils/download-format';
import { DownloadCard } from './DownloadCard';
import { DownloadFooterLoader } from './DownloadFooterLoader';
import { DownloadSectionHeader } from './DownloadSectionHeader';

export type DownloadsListProps = {
  orderedIds: string[];
  sections: DownloadListSection[];
  showSections: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onRefresh: () => void;
  onEndReached: () => void;
  onPressItem: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onOpen: (id: string) => void;
  onShare: (id: string) => void;
  onRemove: (id: string) => void;
  testID?: string;
};

export const DownloadsList = memo(function DownloadsList({
  orderedIds,
  sections,
  showSections,
  refreshing,
  loadingMore,
  hasMore,
  onRefresh,
  onEndReached,
  onPressItem,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onOpen,
  onShare,
  onRemove,
  testID = 'downloads-list',
}: DownloadsListProps) {
  const renderCard = useCallback(
    (id: string) => (
      <DownloadCard
        id={id}
        onPress={onPressItem}
        onPause={onPause}
        onResume={onResume}
        onCancel={onCancel}
        onRetry={onRetry}
        onOpen={onOpen}
        onShare={onShare}
        onRemove={onRemove}
        testID={`download-card-${id}`}
      />
    ),
    [onCancel, onOpen, onPause, onPressItem, onRemove, onResume, onRetry, onShare],
  );

  const renderFlatItem: ListRenderItem<string> = useCallback(
    ({ item }) => renderCard(item),
    [renderCard],
  );

  const renderSectionItem: SectionListRenderItem<string, DownloadListSection> =
    useCallback(({ item }) => renderCard(item), [renderCard]);

  const renderSectionHeader = useCallback(
    ({ section }: { section: DownloadListSection }) => (
      <DownloadSectionHeader
        title={section.title}
        count={section.data.length}
        testID={`downloads-section-${section.key}`}
      />
    ),
    [],
  );

  const keyExtractor = useCallback((id: string) => id, []);

  const handleEndReached = useCallback(() => {
    if (!loadingMore && hasMore) {
      onEndReached();
    }
  }, [hasMore, loadingMore, onEndReached]);

  const footer = useMemo(
    () => (
      <DownloadFooterLoader
        loading={loadingMore}
        hasMore={hasMore}
        visible={orderedIds.length > 0 || sections.length > 0}
      />
    ),
    [hasMore, loadingMore, orderedIds.length, sections.length],
  );

  const contentStyle = useMemo(
    () => ({ flexGrow: 1, paddingBottom: 24 }),
    [],
  );

  if (showSections) {
    return (
      <SectionList
        testID={testID}
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderSectionItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={footer}
        contentContainerStyle={contentStyle}
        accessibilityRole="list"
      />
    );
  }

  return (
    <FlatList
      testID={testID}
      data={orderedIds}
      keyExtractor={keyExtractor}
      renderItem={renderFlatItem}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onEndReached={handleEndReached}
      onEndReachedThreshold={0.4}
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={5}
      removeClippedSubviews
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={footer}
      contentContainerStyle={contentStyle}
      accessibilityRole="list"
    />
  );
});
