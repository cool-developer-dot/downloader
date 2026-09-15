import { memo, useCallback } from 'react';

import { navigation, openPlayer, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { useHomeRecentlyWatched } from '../hooks/useHomeDashboard';
import type { HomeLocalFileMeta } from '../utils/home-derive';

import { HomeMediaRow } from './HomeMediaRow';

export type HomeRecentlyWatchedProps = {
  localById: Record<string, HomeLocalFileMeta>;
};

export const HomeRecentlyWatched = memo(function HomeRecentlyWatched({
  localById,
}: HomeRecentlyWatchedProps) {
  const { items, isLoading } = useHomeRecentlyWatched(localById);
  const { t } = useTranslation();

  const openHistory = useCallback(() => {
    navigation.push(routePaths.watchHistory);
  }, []);

  return (
    <HomeMediaRow
      title={t('home.recentlyWatched')}
      items={items}
      emptyCopy={t('home.watchHistoryEmpty')}
      onPressItem={openPlayer}
      actionLabel={t('home.viewAll')}
      onActionPress={openHistory}
      actionAccessibilityLabel={t('home.viewHistoryA11y')}
      isLoading={isLoading}
      testID="home-recently-watched"
    />
  );
});
