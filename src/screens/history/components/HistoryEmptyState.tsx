import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { EmptyState } from '@/components/common/EmptyState';

import { useTranslation } from '@/localization';

export type HistoryEmptyStateProps = {
  variant?: 'default' | 'search';
  onActionPress?: () => void;
  testID?: string;
};

export const HistoryEmptyState = memo(function HistoryEmptyState({
  variant = 'default',
  onActionPress,
  testID = 'history-empty-state',
}: HistoryEmptyStateProps) {
  const { t } = useTranslation();
  if (variant === 'search') {
    return (
      <Box flex={1} center py={48}>
        <EmptyState
          icon="magnify"
          title={t('history.emptySearchTitle')}
          description={t('history.emptySearchDescription')}
          testID={testID}
        />
      </Box>
    );
  }

  return (
    <Box flex={1} center py={48}>
      <EmptyState
        icon="history"
        title={t('history.emptyTitle')}
        description={t('history.emptyDescription')}
        actionLabel={t('history.emptyAction')}
        onActionPress={onActionPress}
        testID={testID}
      />
    </Box>
  );
});
