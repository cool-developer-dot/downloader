import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { ErrorState } from '@/components/common/ErrorState';

import { useTranslation } from '@/localization';

export type BookmarkErrorStateProps = {
  message: string;
  onRetry: () => void;
  testID?: string;
};

export const BookmarkErrorState = memo(function BookmarkErrorState({
  message,
  onRetry,
  testID = 'bookmarks-error-state',
}: BookmarkErrorStateProps) {
  const { t } = useTranslation();
  return (
    <Box flex={1} center py={48}>
      <ErrorState
        title={t('bookmarks.errorTitle')}
        message={message}
        onRetry={onRetry}
        testID={testID}
      />
    </Box>
  );
});
