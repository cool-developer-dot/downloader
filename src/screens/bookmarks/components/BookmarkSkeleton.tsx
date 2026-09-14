import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useBookmarksTokens } from '../theme/bookmarks-tokens';

function BookmarkSkeletonRow() {
  const bookmarksTokens = useBookmarksTokens();
  return (
    <Box
      row
      px={bookmarksTokens.spacing.screenX}
      py={bookmarksTokens.spacing.rowY}
      gap={bookmarksTokens.spacing.rowGap}
      style={{ alignItems: 'center' }}>
      <Skeleton
        width={bookmarksTokens.faviconSize}
        height={bookmarksTokens.faviconSize}
        borderRadius={bookmarksTokens.radius.favicon}
      />
      <Box flex={1} gap={8}>
        <Skeleton width="70%" height={14} />
        <Skeleton width="45%" height={12} />
      </Box>
      <Skeleton width={40} height={12} />
    </Box>
  );
}

export type BookmarkSkeletonProps = {
  rows?: number;
  testID?: string;
};

export const BookmarkSkeleton = memo(function BookmarkSkeleton({
  rows = 8,
  testID = 'bookmarks-skeleton',
}: BookmarkSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      accessibilityLabel={t('bookmarks.loadingAnnouncement')}
      accessibilityLiveRegion="polite"
      gap={4}
      pt={8}>
      {Array.from({ length: rows }, (_, index) => (
        <BookmarkSkeletonRow key={`bookmark-skeleton-row-${index}`} />
      ))}
    </Box>
  );
});
