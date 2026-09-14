import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import type { MediaLibraryItem } from '@/library';

import { useTranslation } from '@/localization';

import { useLibraryTokens } from '../theme/library-tokens';
import { buildLibraryGridMeta } from '../utils/library-format';

export type LibraryGridTileProps = {
  item: MediaLibraryItem;
  width: number;
  onPress?: (id: string) => void;
  onLongPress?: (id: string) => void;
  testID?: string;
};

export const LibraryGridTile = memo(function LibraryGridTile({
  item,
  width,
  onPress,
  onLongPress,
  testID,
}: LibraryGridTileProps) {
  const libraryTokens = useLibraryTokens();
  const { t } = useTranslation();
  const [thumbFailed, setThumbFailed] = useState(false);
  const meta = buildLibraryGridMeta(item);
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

  return (
    <Pressable
      onPress={onPress && canPlay ? handlePress : undefined}
      onLongPress={onLongPress ? handleLongPress : undefined}
      delayLongPress={350}
      disabled={!onPress || !canPlay}
      accessibilityRole={onPress && canPlay ? 'button' : undefined}
      accessibilityLabel={[
        item.displayName,
        meta,
        item.localAvailability === 'missing' ? t('library.fileUnavailable') : null,
        item.favorite ? t('library.favoriteA11y') : null,
      ]
        .filter(Boolean)
        .join('. ')}
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
        width,
        opacity:
          item.localAvailability === 'missing'
            ? 0.72
            : pressed && onPress && canPlay
              ? 0.88
              : 1,
      })}>
      <Box
        style={{
          borderRadius: libraryTokens.radius.tile,
          overflow: 'hidden',
          backgroundColor: libraryTokens.rowPressed,
        }}>
        <Box
          style={{
            width: '100%',
            height: libraryTokens.gridThumbnailHeight,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: libraryTokens.thumbnailBg,
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
            <Icon name="video-outline" size="lg" color="secondary" />
          )}
          {item.favorite ? (
            <Box
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
              }}>
              <Icon name="heart" size="sm" color="error" accessibilityLabel={t('library.favoriteA11y')} />
            </Box>
          ) : null}
        </Box>
        <Box p={8} gap={4}>
          <Text variant="label" numberOfLines={2}>
            {item.displayName}
          </Text>
          {meta ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </Box>
      </Box>
    </Pressable>
  );
});
