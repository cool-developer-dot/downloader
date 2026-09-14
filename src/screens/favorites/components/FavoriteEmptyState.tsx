import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { EmptyState } from '@/components/common/EmptyState';

import { useTranslation } from '@/localization';

export type FavoriteEmptyStateProps = {
  variant?: 'default' | 'search';
  onActionPress?: () => void;
  testID?: string;
};

export const FavoriteEmptyState = memo(function FavoriteEmptyState({
  variant = 'default',
  onActionPress,
  testID = 'favorites-empty-state',
}: FavoriteEmptyStateProps) {
  const { t } = useTranslation();
  if (variant === 'search') {
    return (
      <Box flex={1} center py={48}>
        <EmptyState
          icon="magnify"
          title={t('favorites.emptySearchTitle')}
          description={t('favorites.emptySearchDescription')}
          testID={testID}
        />
      </Box>
    );
  }

  return (
    <Box flex={1} center py={48}>
      <EmptyState
        icon="heart-outline"
        title={t('favorites.emptyTitle')}
        description={t('favorites.emptyDescription')}
        actionLabel={t('favorites.emptyAction')}
        onActionPress={onActionPress}
        testID={testID}
      />
    </Box>
  );
});
