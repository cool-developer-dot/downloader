import { memo } from 'react';

import { Box } from '@/components/base/Box';
import { Skeleton } from '@/components/common/Skeleton';
import { useTranslation } from '@/localization';

import { useHistoryTokens } from '../theme/history-tokens';

function HistorySkeletonRow() {
  const historyTokens = useHistoryTokens();
  return (
    <Box
      row
      px={historyTokens.spacing.screenX}
      py={historyTokens.spacing.rowY}
      gap={historyTokens.spacing.rowGap}
      style={{ alignItems: 'center' }}>
      <Skeleton
        width={historyTokens.faviconSize}
        height={historyTokens.faviconSize}
        borderRadius={historyTokens.radius.favicon}
      />
      <Box flex={1} gap={8}>
        <Skeleton width="72%" height={14} />
        <Skeleton width="48%" height={12} />
      </Box>
      <Skeleton width={40} height={12} />
    </Box>
  );
}

export type HistorySkeletonProps = {
  rows?: number;
  testID?: string;
};

export const HistorySkeleton = memo(function HistorySkeleton({
  rows = 8,
  testID = 'history-skeleton',
}: HistorySkeletonProps) {
  const historyTokens = useHistoryTokens();
  const { t } = useTranslation();
  return (
    <Box
      testID={testID}
      accessibilityLabel={t('history.loadingAnnouncement')}
      accessibilityLiveRegion="polite"
      gap={4}
      pt={8}>
      <Box px={historyTokens.spacing.screenX} py={12}>
        <Skeleton width={72} height={12} />
      </Box>
      {Array.from({ length: rows }, (_, index) => (
        <HistorySkeletonRow key={`history-skeleton-row-${index}`} />
      ))}
    </Box>
  );
});
