import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import type { MediaLibraryItem } from '@/library';

import { useTranslation } from '@/localization';

import { useLibraryTokens } from '../theme/library-tokens';
import { buildLibraryMetaLine } from '../utils/library-format';

export type LibraryCardProps = {
  item: MediaLibraryItem;
  onPress?: (id: string) => void;
  onLongPress?: (id: string) => void;
  testID?: string;
};

export const LibraryCard = memo(function LibraryCard({
  item,
  onPress,
  onLongPress,
  testID,
}: LibraryCardProps) {
  const libraryTokens = useLibraryTokens();
  const { t } = useTranslation();
  const [thumbFailed, setThumbFailed] = useState(false);
  const metaLine = buildLibraryMetaLine(item);
  const canPlay =
    item.localAvailability === 'available' ||
    item.localAvailability === 'unverified';

  const handlePress = useCallback(() => {
    if (!canPlay) {
      return;
    }
    onPress?.(item.id);
  }, [canPlay, item.id, onPress]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(item.id);
  }, [item.id, onLongPress]);

  const accessibilityParts = [
    item.displayName,
    metaLine,
    item.fileName && item.fileName !== item.displayName ? item.fileName : null,
    item.localAvailability === 'missing' ? t('library.fileUnavailable') : null,
    item.favorite ? t('library.favoriteA11y') : null,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress && canPlay ? handlePress : undefined}
      onLongPress={onLongPress ? handleLongPress : undefined}
      delayLongPress={350}
      disabled={!onPress || !canPlay}
      accessibilityRole={onPress && canPlay ? 'button' : undefined}
      accessibilityLabel={accessibilityParts.join('. ')}
      accessibilityHint={
        onPress && canPlay
          ? onLongPress
            ? t('library.longPressHint')
            : 'Opens video player'
          : item.localAvailability === 'missing'
            ? t('library.fileUnavailable')
            : undefined
      }
      accessibilityState={{ disabled: !canPlay }}
      testID={testID}
      style={({ pressed }) => ({
        paddingHorizontal: libraryTokens.spacing.screenX,
        paddingVertical: libraryTokens.spacing.rowY,
        backgroundColor:
          pressed && onPress && canPlay ? libraryTokens.rowPressed : 'transparent',
        opacity: item.localAvailability === 'missing' ? 0.72 : 1,
      })}>
      <Box row gap={12} style={{ alignItems: 'flex-start', minWidth: 0 }}>
        <Box
          style={{
            width: libraryTokens.thumbnailSize,
            height: libraryTokens.thumbnailSize,
            borderRadius: libraryTokens.radius.thumbnail,
            backgroundColor: libraryTokens.thumbnailBg,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          accessibilityIgnoresInvertColors>
          {item.thumbnailUri && !thumbFailed ? (
            <Image
              source={{ uri: item.thumbnailUri }}
              recyclingKey={item.id}
              cachePolicy="disk"
              transition={200}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              onError={() => setThumbFailed(true)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Icon name="video-outline" size="md" color="secondary" />
          )}
        </Box>

        <Box flex={1} gap={6} style={{ minWidth: 0 }}>
          <Box row gap={8} style={{ alignItems: 'flex-start' }}>
            <Text variant="body" numberOfLines={2} style={{ flex: 1 }}>
              {item.displayName}
            </Text>
            {item.favorite ? (
              <Icon
                name="heart"
                size="sm"
                color="error"
                accessibilityLabel={t('library.favoriteA11y')}
              />
            ) : null}
          </Box>
          {item.fileName && item.fileName !== item.displayName ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {item.fileName}
            </Text>
          ) : null}
          {metaLine ? (
            <Text variant="caption" color="textSecondary" numberOfLines={2}>
              {metaLine}
            </Text>
          ) : null}
          {item.localAvailability === 'missing' ? (
            <Text variant="caption" color="error" numberOfLines={1}>
              {t('library.fileUnavailable')}
            </Text>
          ) : null}
        </Box>
      </Box>
    </Pressable>
  );
});
