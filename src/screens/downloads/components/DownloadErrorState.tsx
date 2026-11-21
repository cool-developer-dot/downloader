import { memo } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ds, DsButton, DsIcon, DsText } from '@/design';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';

export type DownloadErrorStateProps = {
  message: string;
  onRetry: () => void;
  refreshing?: boolean;
  testID?: string;
};

export const DownloadErrorState = memo(function DownloadErrorState({
  message,
  onRetry,
  refreshing = false,
  testID = 'downloads-error-state',
}: DownloadErrorStateProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: ds.space.screenX }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRetry}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
          accessibilityLabel={t('downloads.retryLoadA11y')}
        />
      }>
      <View testID={testID} style={{ alignItems: 'center', paddingVertical: 48, gap: 10 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            backgroundColor: theme.colors.accentSoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <DsIcon name="alert-triangle" size={26} color="primary" strokeWidth={1.8} />
        </View>
        <DsText variant="cardTitle" align="center" accessibilityRole="header" style={{ marginTop: 6 }}>
          {t('lightDownloads.loadFailed')}
        </DsText>
        <DsText variant="body" align="center" style={{ maxWidth: 300 }}>
          {message}
        </DsText>
        <DsButton
          label={t('lightDownloads.retryLoad')}
          variant="secondary"
          icon="refresh-cw"
          onPress={onRetry}
          style={{ marginTop: 10 }}
          testID={`${testID}-retry`}
        />
      </View>
    </ScrollView>
  );
});
