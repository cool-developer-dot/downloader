import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import type { BookmarkEntry } from '@/storage/types';

import { useBookmarksTokens } from '../theme/bookmarks-tokens';
import {
  buildFaviconUrl,
  formatBookmarkDate,
} from '../utils/bookmark-format';

export type BookmarkItemProps = {
  item: BookmarkEntry;
  onPress: (item: BookmarkEntry) => void;
  onDelete: (item: BookmarkEntry) => void;
  testID?: string;
};

export const BookmarkItem = memo(function BookmarkItem({
  item,
  onPress,
  onDelete,
  testID,
}: BookmarkItemProps) {
  const bookmarksTokens = useBookmarksTokens();
  const { t } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);
  const faviconUrl = item.faviconUrl || buildFaviconUrl(item.hostname);
  const dateLabel = formatBookmarkDate(item.createdAt);
  const title = item.title || item.hostname || item.url;

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  const handleDelete = useCallback(() => {
    onDelete(item);
  }, [item, onDelete]);

  return (
    <Box
      testID={testID}
      row
      style={{
        minHeight: bookmarksTokens.rowMinHeight,
        paddingVertical: bookmarksTokens.spacing.rowY,
        paddingLeft: bookmarksTokens.spacing.screenX,
        paddingRight: bookmarksTokens.spacing.screenX - 4,
        alignItems: 'center',
        gap: 8,
      }}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleDelete}
        delayLongPress={420}
        accessibilityRole="button"
        accessibilityLabel={t('bookmarks.itemA11y', {
          title,
          url: item.url,
          date: dateLabel,
        })}
        accessibilityHint={t('bookmarks.openHint')}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: bookmarksTokens.spacing.rowGap,
          minWidth: 0,
          borderRadius: bookmarksTokens.radius.row,
          backgroundColor: pressed ? bookmarksTokens.rowPressed : 'transparent',
          paddingVertical: 2,
        })}>
        <Box
          style={{
            width: bookmarksTokens.faviconSize,
            height: bookmarksTokens.faviconSize,
            borderRadius: bookmarksTokens.radius.favicon,
            backgroundColor: bookmarksTokens.faviconBg,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
          {faviconUrl && !faviconFailed ? (
            <Image
              source={{ uri: faviconUrl }}
              style={{ width: 20, height: 20 }}
              contentFit="contain"
              onError={() => setFaviconFailed(true)}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Icon name="web" size="sm" color="secondary" />
          )}
        </Box>

        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Box row gap={6} style={{ alignItems: 'center' }}>
            <Box flex={1} style={{ minWidth: 0 }}>
              <Text variant="body" numberOfLines={1}>
                {title}
              </Text>
            </Box>
            <Icon
              name="bookmark"
              size="sm"
              color="primary"
              accessibilityLabel={t('bookmarks.bookmarkedA11y')}
            />
          </Box>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {item.hostname || item.url}
          </Text>
        </Box>

        <Text variant="caption" color="textSecondary">
          {dateLabel}
        </Text>
      </Pressable>

      <Pressable
        onPress={handleDelete}
        accessibilityRole="button"
        accessibilityLabel={t('bookmarks.removeItemA11y', { title })}
        accessibilityHint={t('bookmarks.removeOnlyHint')}
        hitSlop={6}
        testID={testID ? `${testID}-delete` : undefined}
        style={({ pressed }) => ({
          width: bookmarksTokens.deleteButtonSize,
          height: bookmarksTokens.deleteButtonSize,
          borderRadius: bookmarksTokens.radius.deleteButton,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed
            ? bookmarksTokens.deleteButtonPressed
            : bookmarksTokens.deleteButtonBg,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}>
        <Icon name="trash-can-outline" size="sm" color="error" />
      </Pressable>
    </Box>
  );
});
