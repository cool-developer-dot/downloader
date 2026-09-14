import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { EmptyState } from '@/components/common/EmptyState';

import { useTranslation } from '@/localization';

export type BookmarkEmptyStateProps = {
  variant?: 'default' | 'search';
  onActionPress?: () => void;
  testID?: string;
};

export const BookmarkEmptyState = memo(function BookmarkEmptyState({
  variant = 'default',
  onActionPress,
  testID = 'bookmarks-empty-state',
}: BookmarkEmptyStateProps) {
  const { t } = useTranslation();
  if (variant === 'search') {
    return (
      <Box flex={1} center py={48}>
        <EmptyState
          icon="magnify"
          title={t('bookmarks.emptySearchTitle')}
          description={t('bookmarks.emptySearchDescription')}
          testID={testID}
        />
      </Box>
    );
  }

  return (
    <Box flex={1} center py={48}>
      <EmptyState
        icon="bookmark-outline"
        title={t('bookmarks.emptyTitle')}
        description={t('bookmarks.emptyDescription')}
        actionLabel={t('bookmarks.emptyAction')}
        onActionPress={onActionPress}
        testID={testID}
      />
    </Box>
  );
});
