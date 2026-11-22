import { memo } from 'react';
import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { ds, DsCard } from '@/design';
import { useRtl, useTranslation } from '@/localization';

function DownloadSkeletonCard() {
  const rtl = useRtl();
  return (
    <DsCard>
      <View style={{ flexDirection: rtl.rowDirection, gap: ds.space.rowGap, alignItems: 'flex-start' }}>
        <Skeleton width={ds.size.thumbWidth} height={ds.size.thumbHeight} borderRadius={ds.radius.thumb} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="78%" height={14} />
          <Skeleton width="52%" height={12} />
        </View>
      </View>
      <View style={{ marginTop: 14, gap: 8 }}>
        <Skeleton width="100%" height={ds.size.progress} borderRadius={ds.size.progress / 2} />
        <Skeleton width="40%" height={12} />
      </View>
    </DsCard>
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
    <View
      testID={testID}
      accessibilityLabel={t('downloads.loadingA11y')}
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: ds.space.screenX, gap: 8 }}>
      {Array.from({ length: rows }, (_, index) => (
        <DownloadSkeletonCard key={`download-skeleton-${index}`} />
      ))}
    </View>
  );
});
