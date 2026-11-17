import { memo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { DsText } from '@/design';
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
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityLabel={loading ? t('favorites.loadingAnnouncement') : t('favorites.endOfList')}
      style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }}>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <DsText variant="rowSub" align="center">
          {t('favorites.endOfList')}
        </DsText>
      ) : null}
    </View>
  );
});
