import { memo } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { useTheme } from '@/hooks/use-theme';

import { useTranslation } from '@/localization';

export type FavoriteFooterLoaderProps = {
  loading: boolean;
  hasMore: boolean;
  visible: boolean;
  testID?: string;
};

export const FavoriteFooterLoader = memo(function FavoriteFooterLoader({
  loading,
  hasMore,
  visible,
  testID = 'favorites-footer-loader',
}: FavoriteFooterLoaderProps) {
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
        loading ? t('favorites.loadingAnnouncement') : t('favorites.endOfList')
      }>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <Text variant="caption" color="textSecondary">
          {t('favorites.endOfList')}
        </Text>
      ) : null}
    </Box>
  );
});
