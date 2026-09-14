import { memo, useCallback } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import { Image } from 'expo-image';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { ProgressBar } from '@/components/common/ProgressBar';
import { useTheme } from '@/hooks/use-theme';
import type { MediaLibraryItem } from '@/library';
import { playerPath, navigation } from '@/navigation';
import {
  formatLastPlayedLabel,
  formatProgressPercentLabel,
  formatRemainingLabel,
  formatResumeLabel,
} from '@/playback/domain/format';
import { clampProgressPercent } from '@/playback/domain/progress';
import { useTranslation } from '@/localization';

export type ContinueWatchingRow = MediaLibraryItem & {
  progressPercent: number;
  positionSeconds: number;
};

type Props = {
  items: ContinueWatchingRow[];
  onSeeAll?: () => void;
};

const ContinueWatchingCard = memo(function ContinueWatchingCard({
  item,
  onPress,
}: {
  item: ContinueWatchingRow;
  onPress: (id: string) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const duration =
    item.duration && item.duration > 0
      ? item.duration
      : item.positionSeconds > 0 && item.progressPercent > 0
        ? item.positionSeconds / (item.progressPercent / 100)
        : 0;
  const pct = clampProgressPercent(item.progressPercent);
  const remaining = formatRemainingLabel(item.positionSeconds, duration);

  return (
    <Pressable
      onPress={() => onPress(item.id)}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${item.displayName}, ${formatResumeLabel(item.positionSeconds)}`}
    >
      <View style={styles.thumbWrap}>
        {item.thumbnailUri ? (
          <Image
            source={{ uri: item.thumbnailUri }}
            recyclingKey={item.id}
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
      </View>
      <Text
        variant="bodySmall"
        numberOfLines={2}
        style={{ color: theme.colors.textPrimary, marginTop: 8 }}
      >
        {item.displayName}
      </Text>
      <ProgressBar
        progress={pct / 100}
        style={{ marginTop: 8, height: 4, borderRadius: 2 }}
        accessibilityLabel={t('library.watchProgressA11y')}
      />
      <Text
        variant="bodySmall"
        style={{ color: theme.colors.textSecondary, marginTop: 4 }}
      >
        {formatProgressPercentLabel(item.positionSeconds, duration)}
        {' · '}
        {formatResumeLabel(item.positionSeconds)}
      </Text>
      {remaining ? (
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.textSecondary }}
        >
          {remaining}
        </Text>
      ) : null}
      {item.lastPlayedAt ? (
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.textSecondary }}
        >
          {formatLastPlayedLabel(item.lastPlayedAt)}
        </Text>
      ) : null}
    </Pressable>
  );
});

export const ContinueWatchingSection = memo(function ContinueWatchingSection({
  items,
  onSeeAll,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation();

  const openPlayer = useCallback((id: string) => {
    navigation.push(playerPath(id));
  }, []);

  const keyExtractor = useCallback((item: ContinueWatchingRow) => item.id, []);

  const renderItem: ListRenderItem<ContinueWatchingRow> = useCallback(
    ({ item }) => <ContinueWatchingCard item={item} onPress={openPlayer} />,
    [openPlayer],
  );

  if (items.length === 0) {
    return null;
  }

  return (
    <Box style={{ marginBottom: 12 }}>
      <Box
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          marginBottom: 8,
        }}
      >
        <Text variant="subtitle" style={{ color: theme.colors.textPrimary }}>
          {t('library.continueWatchingTitle')}
        </Text>
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} accessibilityRole="button">
            <Text variant="bodySmall" style={{ color: theme.colors.primary }}>
              {t('library.watchHistoryTitle')}
            </Text>
          </Pressable>
        ) : null}
      </Box>
      <FlatList
        horizontal
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews
      />
    </Box>
  );
});

const styles = StyleSheet.create({
  card: {
    width: 168,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  thumbWrap: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
});
