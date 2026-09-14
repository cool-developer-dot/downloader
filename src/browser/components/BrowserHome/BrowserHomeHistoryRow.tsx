import { Image } from 'expo-image';
import { memo, useCallback, useMemo, useState } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { BrowserHistoryEntry } from '@/storage/types';
import { buildFaviconUrl } from '@/screens/bookmarks/utils/bookmark-format';

import { browserHomeTokens } from './browser-home-tokens';

export type BrowserHomeHistoryRowProps = {
  item: BrowserHistoryEntry;
  onPress: (item: BrowserHistoryEntry) => void;
  onRemove: (id: string) => void;
  testID?: string;
};

export const BrowserHomeHistoryRow = memo(function BrowserHomeHistoryRow({
  item,
  onPress,
  onRemove,
  testID,
}: BrowserHomeHistoryRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [faviconFailed, setFaviconFailed] = useState(false);

  const faviconUrl = useMemo(
    () => buildFaviconUrl(item.hostname),
    [item.hostname],
  );

  const title = item.title || item.hostname || item.url;

  const handlePress = useCallback(() => {
    onPress(item);
  }, [item, onPress]);

  const handleRemove = useCallback(() => {
    onRemove(item.id);
  }, [item.id, onRemove]);

  return (
    <Box
      testID={testID}
      row
      style={{
        minHeight: browserHomeTokens.historyRowMinHeight,
        alignItems: 'center',
        gap: 10,
        paddingVertical: 6,
      }}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t('history.itemA11y', {
          title,
          url: item.url,
          relative: '',
        })}
        style={({ pressed }) => ({
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          borderRadius: 12,
          backgroundColor: pressed ? theme.colors.surface : 'transparent',
          paddingVertical: 4,
          paddingHorizontal: 4,
        })}>
        <Box
          center
          style={{
            width: browserHomeTokens.historyFaviconSize,
            height: browserHomeTokens.historyFaviconSize,
            borderRadius: 10,
            backgroundColor: theme.colors.surface,
            borderWidth: 1,
            borderColor: theme.colors.border,
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
          <Text variant="bodySmall" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {item.hostname || item.url}
          </Text>
        </Box>
      </Pressable>

      <Pressable
        onPress={handleRemove}
        accessibilityRole="button"
        accessibilityLabel={t('history.removeItemA11y', { title })}
        hitSlop={8}
        testID={testID ? `${testID}-remove` : undefined}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? theme.colors.surface : 'transparent',
        })}>
        <Icon name="trash-can-outline" size="sm" color="error" />
      </Pressable>
    </Box>
  );
});
