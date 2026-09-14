import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useHomeLayout } from '../theme/home-layout';

export const HomeMediaRowSkeleton = memo(function HomeMediaRowSkeleton({
  testID,
}: {
  testID?: string;
}) {
  const { t } = useTranslation();
  const layout = useHomeLayout();
  const thumbHeight = Math.round((layout.cardWidth * 9) / 16);

  return (
    <Box row gap={12} testID={testID} accessibilityLabel={t('common.loading')}>
      {[0, 1, 2].map((key) => (
        <Box key={key} gap={8} style={{ width: layout.cardWidth }}>
          <Skeleton
            width={layout.cardWidth}
            height={thumbHeight}
            borderRadius={layout.thumbRadius}
          />
          <Skeleton width="80%" height={layout.theme.spacing[12]} />
          <Skeleton width="55%" height={layout.theme.spacing[8]} />
        </Box>
      ))}
    </Box>
  );
});
