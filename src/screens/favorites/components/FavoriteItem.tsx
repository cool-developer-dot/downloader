import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import type { FavoriteItem as FavoriteEntry } from '@/store/favorites';

import { useFavoritesTokens } from '../theme/favorites-tokens';
import {
  buildFavoriteMetaLine,
  formatFavoriteHost,
} from '../utils/favorite-format';

export type FavoriteItemProps = {
  item: FavoriteEntry;
  unavailable?: boolean;
  removing?: boolean;
  onPress: (item: FavoriteEntry) => void;
  onRemove: (item: FavoriteEntry) => void;
  testID?: string;
};

export const FavoriteItem = memo(function FavoriteItem({
  item,
  unavailable = false,
  removing = false,
  onPress,
  onRemove,
  testID,
}: FavoriteItemProps) {
  const favoritesTokens = useFavoritesTokens();
  const { t } = useTranslation();
  const [thumbFailed, setThumbFailed] = useState(false);
  const title = item.title?.trim() || formatFavoriteHost(item.sourceUrl) || t('favorites.title');
  const meta = buildFavoriteMetaLine(item);
  const host = formatFavoriteHost(item.sourceUrl);

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  const handleRemove = useCallback(() => {
    onRemove(item);
  }, [item, onRemove]);

  const a11yLabel = unavailable
    ? t('favorites.itemUnavailableA11y', { title })
    : t('favorites.itemA11y', { title, meta });

  return (
    <Box
      testID={testID}
      row
      style={{
        minHeight: favoritesTokens.rowMinHeight,
        paddingVertical: favoritesTokens.spacing.rowY,
        paddingLeft: favoritesTokens.spacing.screenX,
        paddingRight: favoritesTokens.spacing.screenX - 4,
        alignItems: 'center',
        gap: 8,
        opacity: unavailable ? 0.92 : 1,
      }}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleRemove}
        delayLongPress={420}
        disabled={removing}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint={
          unavailable ? t('favorites.unavailableHint') : t('favorites.openHint')
        }
        accessibilityState={{ disabled: removing }}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: favoritesTokens.spacing.rowGap,
          minWidth: 0,
          borderRadius: favoritesTokens.radius.row,
          backgroundColor: pressed
            ? favoritesTokens.rowPressed
            : unavailable
              ? favoritesTokens.unavailableBg
              : 'transparent',
          paddingVertical: 2,
          paddingRight: 4,
        })}>
        <Box
          style={{
            width: favoritesTokens.thumbnailSize,
            height: favoritesTokens.thumbnailSize,
            borderRadius: favoritesTokens.radius.thumbnail,
            backgroundColor: favoritesTokens.thumbnailBg,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
          {item.thumbnailUrl && !thumbFailed ? (
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={{
                width: favoritesTokens.thumbnailSize,
                height: favoritesTokens.thumbnailSize,
              }}
              contentFit="cover"
              onError={() => setThumbFailed(true)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Icon name="heart-outline" size="md" color="secondary" />
          )}
        </Box>

        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Box row gap={6} style={{ alignItems: 'center' }}>
            <Box flex={1} style={{ minWidth: 0 }}>
              <Text variant="body" numberOfLines={2}>
                {title}
              </Text>
            </Box>
            <Icon
              name="heart"
              size="sm"
              color="error"
              accessibilityLabel={t('favorites.favoritedA11y')}
            />
          </Box>
          {meta ? (
            <Text variant="caption" color="textSecondary" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {unavailable ? t('favorites.downloadUnavailableLabel') : host}
          </Text>
        </Box>
      </Pressable>

      <Pressable
        onPress={handleRemove}
        disabled={removing}
        accessibilityRole="button"
        accessibilityLabel={t('favorites.removeItemA11y', { title })}
        accessibilityHint={t('favorites.removeOnlyHint')}
        accessibilityState={{ disabled: removing }}
        hitSlop={6}
        testID={testID ? `${testID}-remove` : undefined}
        style={({ pressed }) => ({
          width: favoritesTokens.removeButtonSize,
          height: favoritesTokens.removeButtonSize,
          borderRadius: favoritesTokens.radius.removeButton,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: removing ? 0.5 : 1,
          backgroundColor: pressed
            ? favoritesTokens.removeButtonPressed
            : favoritesTokens.removeButtonBg,
          transform: [{ scale: pressed && !removing ? 0.92 : 1 }],
        })}>
        <Icon name="heart-off-outline" size="sm" color="error" />
      </Pressable>
    </Box>
  );
});
