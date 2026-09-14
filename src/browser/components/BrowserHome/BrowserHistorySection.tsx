import { memo, useCallback } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import type { BrowserHistoryEntry } from '@/storage/types';

import { BrowserHomeHistoryRow } from './BrowserHomeHistoryRow';
import { browserHomeTokens } from './browser-home-tokens';

export type BrowserHistorySectionProps = {
  items: BrowserHistoryEntry[];
  loading: boolean;
  onOpenItem: (item: BrowserHistoryEntry) => void;
  onRemoveItem: (id: string) => void;
  onClearHistory: () => void;
  onViewAll: () => void;
  testID?: string;
};

export const BrowserHistorySection = memo(function BrowserHistorySection({
  items,
  loading,
  onOpenItem,
  onRemoveItem,
  onClearHistory,
  onViewAll,
  testID = 'browser-home-history',
}: BrowserHistorySectionProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleOpen = useCallback(
    (item: BrowserHistoryEntry) => {
      onOpenItem(item);
    },
    [onOpenItem],
  );

  return (
    <Box testID={testID} gap={12}>
      <Box row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" color="textSecondary" style={{ letterSpacing: 0.8 }}>
          {t('browser.home.recentHistory')}
        </Text>

        <Box row gap={4}>
          {items.length > 0 ? (
            <Pressable
              onPress={onClearHistory}
              accessibilityRole="button"
              accessibilityLabel={t('browser.home.clearHistoryA11y')}
              hitSlop={8}
              testID={`${testID}-clear`}
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
          ) : null}

          <Pressable
            onPress={onViewAll}
            accessibilityRole="button"
            accessibilityLabel={t('browser.home.viewAllHistoryA11y')}
            hitSlop={8}
            testID={`${testID}-view-all`}
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: pressed ? theme.colors.surface : 'transparent',
            })}>
            <Text variant="caption" color="primary">
              {t('browser.home.viewAll')}
            </Text>
          </Pressable>
        </Box>
      </Box>

      {!loading && items.length === 0 ? (
        <Box py={16} px={8}>
          <Text variant="bodySmall" color="textSecondary" align="center">
            {t('browser.home.noRecentHistory')}
          </Text>
        </Box>
      ) : (
        <Box
          style={{
            borderRadius: browserHomeTokens.tileRadius,
            backgroundColor: theme.colors.card,
            borderWidth: 1,
            borderColor: theme.colors.border,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}>
          {items.map((item) => (
            <BrowserHomeHistoryRow
              key={item.id}
              item={item}
              onPress={handleOpen}
              onRemove={onRemoveItem}
              testID={`${testID}-row-${item.id}`}
            />
          ))}
        </Box>
      )}
    </Box>
  );
});
