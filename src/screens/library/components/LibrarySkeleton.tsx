import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';

import { useLibraryTokens } from '../theme/library-tokens';

function LibrarySkeletonRow() {
  const libraryTokens = useLibraryTokens();
  return (
    <Box
      px={libraryTokens.spacing.screenX}
      py={libraryTokens.spacing.rowY}
      gap={libraryTokens.spacing.cardGap}>
      <Box row gap={12} style={{ alignItems: 'flex-start' }}>
        <Skeleton
          width={libraryTokens.thumbnailSize}
          height={libraryTokens.thumbnailSize}
          borderRadius={libraryTokens.radius.thumbnail}
        />
        <Box flex={1} gap={8}>
          <Skeleton width="78%" height={14} />
          <Skeleton width="52%" height={12} />
          <Skeleton width="40%" height={12} />
        </Box>
      </Box>
    </Box>
  );
}

export type LibrarySkeletonProps = {
  rows?: number;
  testID?: string;
};

export const LibrarySkeleton = memo(function LibrarySkeleton({
  rows = 6,
  testID = 'library-skeleton',
}: LibrarySkeletonProps) {
  return (
    <Box
      testID={testID}
      accessibilityLabel={undefined}
      accessibilityLiveRegion="polite"
      gap={4}
      pt={8}>
      {Array.from({ length: rows }, (_, index) => (
        <LibrarySkeletonRow key={`library-skeleton-${index}`} />
      ))}
    </Box>
  );
});
