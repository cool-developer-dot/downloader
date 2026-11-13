import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { useRtl, useTranslation } from '@/localization';

import { useHistoryTokens } from '../theme/history-tokens';

export type HistoryClearSearchesRowProps = {
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

/** "Clear recent searches": the searches typed in the address bar, not the pages in the list below. */
export const HistoryClearSearchesRow = memo(function HistoryClearSearchesRow({
  onPress,
  disabled = false,
  testID = 'history-clear-searches',
}: HistoryClearSearchesRowProps) {
  const historyTokens = useHistoryTokens();
  const { t } = useTranslation();
  const rtl = useRtl();

  return (
    <Box px={historyTokens.spacing.screenX} pb={8}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('history.clearSearches')}
        accessibilityHint={t('history.clearSearchesHint')}
        accessibilityState={{ disabled }}
        testID={testID}
        style={({ pressed }) => ({
          flexDirection: rtl.rowDirection,
          alignItems: 'center',
          gap: historyTokens.spacing.rowGap,
          minHeight: historyTokens.touchTarget,
          paddingVertical: 8,
          paddingHorizontal: 8,
          borderRadius: historyTokens.radius.row,
          backgroundColor: pressed ? historyTokens.rowPressed : 'transparent',
          opacity: disabled ? 0.5 : 1,
        })}>
        <Box
          style={{
            width: historyTokens.faviconSize,
            height: historyTokens.faviconSize,
            borderRadius: historyTokens.radius.favicon,
            backgroundColor: historyTokens.faviconBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Icon name="magnify-remove-outline" size="sm" color="primary" />
        </Box>
        <Box flex={1} gap={2} style={{ minWidth: 0 }}>
          <Text variant="body" style={{ textAlign: rtl.textAlign }}>
            {t('history.clearSearches')}
          </Text>
          <Text variant="caption" color="textSecondary" style={{ textAlign: rtl.textAlign }}>
            {t('history.clearSearchesHint')}
          </Text>
        </Box>
      </Pressable>
    </Box>
  );
});
