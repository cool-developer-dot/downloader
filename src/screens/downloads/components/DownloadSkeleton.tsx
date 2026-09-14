import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useDownloadsTokens } from '../theme/downloads-tokens';

function DownloadSkeletonCard() {
  const downloadsTokens = useDownloadsTokens();
  return (
    <Box
      px={downloadsTokens.spacing.screenX}
      py={downloadsTokens.spacing.rowY}
      gap={downloadsTokens.spacing.cardGap}>
      <Box row gap={12} style={{ alignItems: 'flex-start' }}>
        <Skeleton
          width={downloadsTokens.thumbnailSize}
          height={downloadsTokens.thumbnailSize}
          borderRadius={downloadsTokens.radius.thumbnail}
        />
        <Box flex={1} gap={8}>
          <Skeleton width="78%" height={14} />
          <Skeleton width="52%" height={12} />
          <Skeleton width="100%" height={8} borderRadius={downloadsTokens.radius.badge} />
          <Skeleton width="40%" height={12} />
        </Box>
      </Box>
    </Box>
  );
}

export type DownloadSkeletonProps = {
  rows?: number;
  testID?: string;
};

export const DownloadSkeleton = memo(function DownloadSkeleton({
  rows = 6,
  testID = 'downloads-skeleton',
}: DownloadSkeletonProps) {
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      accessibilityLabel={t('downloads.loadingA11y')}
      accessibilityLiveRegion="polite"
      gap={4}
      pt={8}>
      {Array.from({ length: rows }, (_, index) => (
        <DownloadSkeletonCard key={`download-skeleton-${index}`} />
      ))}
    </Box>
  );
});
