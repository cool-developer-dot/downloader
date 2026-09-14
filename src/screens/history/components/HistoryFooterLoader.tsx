import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { useTranslation } from '@/localization';

export type HistoryFooterLoaderProps = {
  loading: boolean;
  hasMore: boolean;
  visible: boolean;
  testID?: string;
};

export const HistoryFooterLoader = memo(function HistoryFooterLoader({
  loading,
  hasMore,
  visible,
  testID = 'history-footer-loader',
}: HistoryFooterLoaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <Box
      testID={testID}
      center
      py={20}
      accessibilityLiveRegion="polite"
      accessibilityLabel={loading ? t('history.loadingAnnouncement') : t('history.endOfList')}>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <Text variant="caption" color="textSecondary">
          {t('history.endOfList')}
        </Text>
      ) : null}
    </Box>
  );
});
