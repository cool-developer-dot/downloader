import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { ErrorState } from '@/components/common/ErrorState';

import { useTranslation } from '@/localization';

export type HistoryErrorStateProps = {
  message: string;
  onRetry: () => void;
  testID?: string;
};

export const HistoryErrorState = memo(function HistoryErrorState({
  message,
  onRetry,
  testID = 'history-error-state',
}: HistoryErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Box flex={1} center py={48}>
      <ErrorState
        title={t('history.errorTitle')}
        message={message}
        onRetry={onRetry}
        testID={testID}
      />
    </Box>
  );
});
