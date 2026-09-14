import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useDownloadsTokens } from '../theme/downloads-tokens';

export type DownloadDetailsSkeletonProps = {
  testID?: string;
};

export const DownloadDetailsSkeleton = memo(function DownloadDetailsSkeleton({
  testID = 'download-details-skeleton',
}: DownloadDetailsSkeletonProps) {
  const downloadsTokens = useDownloadsTokens();
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      px={downloadsTokens.spacing.screenX}
      pt={8}
      gap={16}
      accessibilityLabel={t('downloads.loadingDetailsA11y')}
      accessibilityLiveRegion="polite">
      <Skeleton
        width="100%"
        height={downloadsTokens.heroHeight}
        borderRadius={downloadsTokens.radius.card}
      />
      <Skeleton width="78%" height={20} />
      <Skeleton width="48%" height={14} />
      <Skeleton width={88} height={24} borderRadius={downloadsTokens.radius.badge} />
      <Skeleton width="36%" height={32} />
      <Skeleton
        width="100%"
        height={10}
        borderRadius={downloadsTokens.radius.badge}
      />
      <Skeleton width="55%" height={14} />
      <Skeleton
        width="100%"
        height={48}
        borderRadius={downloadsTokens.radius.card}
      />
      <Box gap={10} mt={8}>
        <Skeleton width="40%" height={14} />
        <Skeleton width="100%" height={16} />
        <Skeleton width="100%" height={16} />
        <Skeleton width="100%" height={16} />
      </Box>
    </Box>
  );
});
