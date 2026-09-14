import { memo, useCallback } from 'react';

import { navigation, playerPath, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';

import { useHomeContinueWatching } from '../hooks/useHomeDashboard';
import type { HomeLocalFileMeta } from '../utils/home-derive';

import { HomeMediaRow } from './HomeMediaRow';

export type HomeContinueWatchingProps = {
  localById: Record<string, HomeLocalFileMeta>;
};

export const HomeContinueWatching = memo(function HomeContinueWatching({
  localById,
}: HomeContinueWatchingProps) {
  const { items, isLoading } = useHomeContinueWatching(localById);
  const { t } = useTranslation();

  const openPlayer = useCallback((mediaId: string) => {
    navigation.push(playerPath(mediaId));
  }, []);

  const openHistory = useCallback(() => {
    navigation.push(routePaths.watchHistory);
  }, []);

  return (
    <HomeMediaRow
      title={t('home.continueWatching')}
      items={items}
      emptyCopy={t('home.noVideosToContinue')}
      onPressItem={openPlayer}
      actionLabel={t('home.viewAll')}
      onActionPress={openHistory}
      actionAccessibilityLabel={t('home.viewHistoryA11y')}
      showProgress
      isLoading={isLoading}
      testID="home-continue-watching"
    />
  );
});
