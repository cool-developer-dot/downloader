import { memo } from 'react';
import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { ds, DsCard } from '@/design';
import { useRtl, useTranslation } from '@/localization';

function FavoriteSkeletonRow() {
  const rtl = useRtl();
  return (
    <DsCard>
      <View style={{ flexDirection: rtl.rowDirection, alignItems: 'flex-start', gap: ds.space.rowGap }}>
        <Skeleton width={64} height={ds.size.thumbHeight} borderRadius={ds.radius.thumb} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="72%" height={14} />
          <Skeleton width="48%" height={12} />
          <Skeleton width="36%" height={12} />
        </View>
      </View>
    </DsCard>
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
    <View
      testID={testID}
      accessibilityLabel={t('favorites.loadingAnnouncement')}
      accessibilityLiveRegion="polite"
      style={{ paddingHorizontal: ds.space.screenX, gap: 8 }}>
      {Array.from({ length: rows }, (_, index) => (
        <FavoriteSkeletonRow key={`favorite-skeleton-row-${index}`} />
      ))}
    </View>
  );
});
