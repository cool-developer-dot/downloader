import { Image } from 'expo-image';
import { memo, useCallback, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTranslation } from '@/localization';
import type { BrowserHistoryEntry } from '@/storage/types';

import { useHistoryTokens } from '../theme/history-tokens';
import {
  buildFaviconUrl,
  formatHistoryClockTime,
  formatHistoryRelativeTime,
} from '../utils/history-format';

export type HistoryItemProps = {
  item: BrowserHistoryEntry;
  onPress: (item: BrowserHistoryEntry) => void;
  onDelete: (item: BrowserHistoryEntry) => void;
  testID?: string;
};

export const HistoryItem = memo(function HistoryItem({
  item,
  onPress,
  onDelete,
  testID,
}: HistoryItemProps) {
  const historyTokens = useHistoryTokens();
  const { t } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);
  const faviconUrl = buildFaviconUrl(item.hostname);
  const relative = formatHistoryRelativeTime(item.visitedAt);
  const clock = formatHistoryClockTime(item.visitedAt);
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
        minHeight: historyTokens.rowMinHeight,
        paddingVertical: historyTokens.spacing.rowY,
        paddingLeft: historyTokens.spacing.screenX,
        paddingRight: historyTokens.spacing.screenX - 4,
        alignItems: 'center',
        gap: 8,
      }}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleDelete}
        delayLongPress={420}
        accessibilityRole="button"
        accessibilityLabel={t('history.itemA11y', {
          title,
          url: item.url,
          relative,
        })}
        accessibilityHint={t('history.openHint')}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: historyTokens.spacing.rowGap,
          minWidth: 0,
          borderRadius: historyTokens.radius.row,
          backgroundColor: pressed ? historyTokens.rowPressed : 'transparent',
          paddingVertical: 2,
        })}>
        <Box
          style={{
            width: historyTokens.faviconSize,
            height: historyTokens.faviconSize,
            borderRadius: historyTokens.radius.favicon,
            backgroundColor: historyTokens.faviconBg,
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
          <Text variant="body" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {item.hostname || item.url}
          </Text>
        </Box>

        <Box gap={2} style={{ alignItems: 'flex-end', minWidth: 52 }}>
          <Text variant="caption" color="textSecondary">
            {relative}
          </Text>
          {clock ? (
            <Text variant="caption" color="textDisabled">
              {clock}
            </Text>
          ) : null}
        </Box>
      </Pressable>

      <Pressable
        onPress={handleDelete}
        accessibilityRole="button"
        accessibilityLabel={t('history.removeItemA11y', { title })}
        accessibilityHint={t('history.removeOnlyHint')}
        hitSlop={6}
        testID={testID ? `${testID}-delete` : undefined}
        style={({ pressed }) => ({
          width: historyTokens.deleteButtonSize,
          height: historyTokens.deleteButtonSize,
          borderRadius: historyTokens.radius.deleteButton,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed
            ? historyTokens.deleteButtonPressed
            : historyTokens.deleteButtonBg,
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}>
        <Icon name="trash-can-outline" size="sm" color="error" />
      </Pressable>
    </Box>
  );
});
