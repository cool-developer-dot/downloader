import { memo } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { Box } from '@/components/base/Box';
import { ErrorState } from '@/components/common/ErrorState';
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
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
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
      <Box flex={1} center py={48}>
        <ErrorState
          title={t('downloads.errorTitle')}
          message={message}
          onRetry={onRetry}
          testID={testID}
        />
      </Box>
    </ScrollView>
  );
});
