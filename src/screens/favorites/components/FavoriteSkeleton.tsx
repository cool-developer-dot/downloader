import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useFavoritesTokens } from '../theme/favorites-tokens';

function FavoriteSkeletonRow() {
  const favoritesTokens = useFavoritesTokens();
  return (
    <Box
      row
      px={favoritesTokens.spacing.screenX}
      py={favoritesTokens.spacing.rowY}
      gap={favoritesTokens.spacing.rowGap}
      style={{ alignItems: 'center' }}>
      <Skeleton
        width={favoritesTokens.thumbnailSize}
        height={favoritesTokens.thumbnailSize}
        borderRadius={favoritesTokens.radius.thumbnail}
      />
      <Box flex={1} gap={8}>
        <Skeleton width="72%" height={14} />
        <Skeleton width="48%" height={12} />
        <Skeleton width="36%" height={12} />
      </Box>
      <Skeleton
        width={favoritesTokens.removeButtonSize}
        height={favoritesTokens.removeButtonSize}
        borderRadius={favoritesTokens.radius.removeButton}
      />
    </Box>
  );
}

export type FavoriteSkeletonProps = {
  rows?: number;
  testID?: string;
};

export const FavoriteSkeleton = memo(function FavoriteSkeleton({
  rows = 7,
  testID = 'favorites-skeleton',
}: FavoriteSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      accessibilityLabel={t('favorites.loadingAnnouncement')}
      accessibilityLiveRegion="polite"
      gap={4}
      pt={8}>
      {Array.from({ length: rows }, (_, index) => (
        <FavoriteSkeletonRow key={`favorite-skeleton-row-${index}`} />
      ))}
    </Box>
  );
});
