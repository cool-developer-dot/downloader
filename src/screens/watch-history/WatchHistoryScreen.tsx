import { memo, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import { Image } from 'expo-image';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { ProgressBar } from '@/components/common/ProgressBar';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { ScreenHeader } from '@/components/headers/ScreenHeader';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { navigation, playerPath } from '@/navigation';
import {
  formatLastPlayedLabel,
  formatProgressPercentLabel,
} from '@/playback/domain/format';
import type { PlaybackSummary } from '@/playback/domain/merge';
import { clampProgressPercent } from '@/playback/domain/progress';
import { usePlaybackHistoryInfiniteQuery } from '@/playback/hooks';
import {
  selectDownloadCatalogIdentitySignature,
  useDownloadsStore,
} from '@/store/downloads';
import { useLibraryStore } from '@/store/library';

type HistoryRow = PlaybackSummary & {
  displayName: string;
  thumbnailUri: string | null;
  missing: boolean;
};

const WatchHistoryRow = memo(function WatchHistoryRow({
  item,
  onPress,
}: {
  item: HistoryRow;
  onPress: (item: HistoryRow) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const pct = clampProgressPercent(item.progressPercent) / 100;

  return (
    <Pressable
      disabled={item.missing}
      onPress={() => onPress(item)}
      style={[
        styles.row,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          opacity: item.missing ? 0.55 : 1,
        },
      ]}
      accessibilityRole="button"
    >
      {item.thumbnailUri ? (
        <Image
          source={{ uri: item.thumbnailUri }}
          recyclingKey={item.mediaId}
          cachePolicy="disk"
          transition={200}
          style={styles.thumb}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.thumb,
            { backgroundColor: theme.colors.surface },
          ]}
        />
      )}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text
          variant="subtitle"
          numberOfLines={2}
          style={{ color: theme.colors.textPrimary }}
        >
          {item.displayName}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.textSecondary, marginTop: 4 }}
        >
          {item.lastPlayedAt ? formatLastPlayedLabel(item.lastPlayedAt) : ''}
          {item.completed ? ` · ${t('library.watchedBadge')}` : ''}
          {item.missing ? ` · ${t('watchHistory.missing')}` : ''}
        </Text>
        {!item.completed ? (
          <>
            <ProgressBar
              progress={pct}
              style={{ marginTop: 8, height: 4 }}
              accessibilityLabel={t('watchHistory.watchProgressA11y')}
            />
            <Text
              variant="bodySmall"
              style={{
                color: theme.colors.textSecondary,
                marginTop: 4,
              }}
            >
              {formatProgressPercentLabel(
                item.positionSeconds,
                item.durationSeconds,
              )}
            </Text>
          </>
        ) : (
          <Text
            variant="bodySmall"
            style={{ color: theme.colors.primary, marginTop: 6 }}
          >
            {t('library.watchedBadge')}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

export const WatchHistoryScreen = memo(function WatchHistoryScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    items,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    isError,
    refetch,
    isOfflineFallback,
  } = usePlaybackHistoryInfiniteQuery();

  const availabilityById = useLibraryStore((s) => s.availabilityById);
  const catalogIdentity = useDownloadsStore(
    selectDownloadCatalogIdentitySignature,
  );

  const rows = useMemo<HistoryRow[]>(() => {
    void catalogIdentity;
    const downloadsById = useDownloadsStore.getState().itemsById;
    return items.map((item) => {
      const download = downloadsById[item.mediaId];
      const availability = availabilityById[item.mediaId];
      const missing =
        availability === 'missing' ||
        (!download && availability !== 'available');
      return {
        ...item,
        displayName: download?.title?.trim() || 'Video',
        thumbnailUri: download?.thumbnailUrl ?? null,
        missing,
      };
    });
  }, [items, catalogIdentity, availabilityById]);

  const openItem = useCallback((item: HistoryRow) => {
    if (item.missing) {
      return;
    }
    navigation.push(playerPath(item.mediaId));
  }, []);

  const keyExtractor = useCallback((item: HistoryRow) => item.mediaId, []);

  const renderItem: ListRenderItem<HistoryRow> = useCallback(
    ({ item }) => <WatchHistoryRow item={item} onPress={openItem} />,
    [openItem],
  );

  return (
    <SafeAreaScreen edges={['top', 'left', 'right']}>
      <ScreenHeader title={t('watchHistory.title')} onBackPress={() => navigation.back()} />
      {isOfflineFallback ? (
        <Text
          variant="bodySmall"
          style={{
            color: theme.colors.textSecondary,
            paddingHorizontal: 16,
            marginBottom: 8,
          }}
        >
          {t('watchHistory.offlineHint')}
        </Text>
      ) : null}
      {isLoading ? (
        <Box center style={{ flex: 1 }}>
          <ActivityIndicator />
        </Box>
      ) : isError ? (
        <ErrorState
          title={t('watchHistory.errorTitle')}
          message={t('errors.network')}
          retryLabel={t('common.retry')}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="history"
          title={t('watchHistory.emptyTitle')}
          description={t('watchHistory.emptyDescription')}
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={7}
          removeClippedSubviews
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              void fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      )}
    </SafeAreaScreen>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 10,
  },
  thumb: {
    width: 96,
    aspectRatio: 16 / 9,
    borderRadius: 8,
  },
});
