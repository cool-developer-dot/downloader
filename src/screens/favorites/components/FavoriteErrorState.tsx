import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { ErrorState } from '@/components/common/ErrorState';

import { useTranslation } from '@/localization';

export type FavoriteErrorStateProps = {
  message: string;
  onRetry: () => void;
  testID?: string;
};

export const FavoriteErrorState = memo(function FavoriteErrorState({
  message,
  onRetry,
  testID = 'favorites-error-state',
}: FavoriteErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Box flex={1} center py={48}>
      <ErrorState
        title={t('favorites.errorTitle')}
        message={message}
        onRetry={onRetry}
        testID={testID}
      />
    </Box>
  );
});
