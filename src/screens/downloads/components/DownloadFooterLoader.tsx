import { memo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { DsText } from '@/design';
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
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      accessibilityLabel={loading ? t('downloads.loadingAnnouncement') : t('downloads.endOfList')}
      style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 20 }}>
      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : !hasMore ? (
        <DsText variant="rowSub" align="center">
          {t('downloads.endOfList')}
        </DsText>
      ) : null}
    </View>
  );
});
