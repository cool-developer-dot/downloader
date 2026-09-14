import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type DownloadFooterLoaderProps = {
  loading: boolean;
  hasMore: boolean;
  visible: boolean;
  testID?: string;
};

export const DownloadFooterLoader = memo(function DownloadFooterLoader({
  loading,
  hasMore,
  visible,
  testID = 'downloads-footer-loader',
}: DownloadFooterLoaderProps) {
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
      accessibilityLabel={
        loading ? t('downloads.loadingAnnouncement') : t('downloads.endOfList')
      }>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <Text variant="caption" color="textSecondary">
          {t('downloads.endOfList')}
        </Text>
      ) : null}
    </Box>
  );
});
