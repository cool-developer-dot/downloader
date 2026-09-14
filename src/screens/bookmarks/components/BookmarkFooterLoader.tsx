import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { useTranslation } from '@/localization';

export type BookmarkFooterLoaderProps = {
  loading: boolean;
  hasMore: boolean;
  visible: boolean;
  testID?: string;
};

export const BookmarkFooterLoader = memo(function BookmarkFooterLoader({
  loading,
  hasMore,
  visible,
  testID = 'bookmarks-footer-loader',
}: BookmarkFooterLoaderProps) {
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
        loading ? t('bookmarks.loadingAnnouncement') : t('bookmarks.endOfList')
      }>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <Text variant="caption" color="textSecondary">
          {t('bookmarks.endOfList')}
        </Text>
      ) : null}
    </Box>
  );
});
