import { memo, useCallback } from 'react';

import { navigation, playerPath, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { useHomeRecentDownloads } from '../hooks/useHomeDashboard';
import type { HomeLocalFileMeta } from '../utils/home-derive';

import { HomeMediaRow } from './HomeMediaRow';

export type HomeRecentDownloadsProps = {
  localById: Record<string, HomeLocalFileMeta>;
  localReady: boolean;
};

export const HomeRecentDownloads = memo(function HomeRecentDownloads({
  localById,
  localReady,
}: HomeRecentDownloadsProps) {
  const { items, isLoading } = useHomeRecentDownloads(localById, localReady);
  const { t } = useTranslation();

  const openPlayer = useCallback((mediaId: string) => {
    navigation.push(playerPath(mediaId));
  }, []);

  const openLibrary = useCallback(() => {
    navigation.navigate(routePaths.library);
  }, []);

  return (
    <HomeMediaRow
      title={t('home.recentDownloads')}
      items={items}
      emptyCopy={t('home.noDownloadsYet')}
      onPressItem={openPlayer}
      actionLabel={t('home.viewAll')}
      onActionPress={openLibrary}
      actionAccessibilityLabel={t('home.viewLibraryA11y')}
      isLoading={isLoading}
      testID="home-recent-downloads"
    />
  );
});
