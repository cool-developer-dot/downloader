import { memo, useCallback, useMemo } from 'react';

import { Box } from '@/components/base/Box';
import { Icon } from '@/components/base/Icon';
import { Pressable } from '@/components/base/Pressable';
import { Text } from '@/components/base/Text';
import { Card } from '@/components/cards/Card';
import { ProgressBar } from '@/components/common/ProgressBar';
import { navigation, routePaths } from '@/navigation';
import { useTranslation } from '@/localization';
import { useHomeDownloadActivity } from '../hooks/useHomeDashboard';
import { useHomeLayout } from '../theme/home-layout';

export const HomeActiveDownloads = memo(function HomeActiveDownloads() {
  const layout = useHomeLayout();
  const activity = useHomeDownloadActivity();
  const { t } = useTranslation();

  const openDownloads = useCallback(() => {
    navigation.navigate(routePaths.downloads);
  }, []);

  const hasActivity =
    activity.activeCount > 0 ||
    activity.pausedCount > 0 ||
    activity.queuedCount > 0;

  const summary = useMemo(() => {
    if (!hasActivity) {
      return t('home.noActiveDownloads');
    }
    const parts: string[] = [];
    if (activity.activeCount > 0) {
      parts.push(t('home.downloadingCount', { count: activity.activeCount }));
    }
    if (activity.pausedCount > 0) {
      parts.push(t('home.pausedCount', { count: activity.pausedCount }));
    }
    if (activity.queuedCount > 0) {
      parts.push(t('home.queuedCount', { count: activity.queuedCount }));
    }
    return parts.join(' · ');
  }, [
    activity.activeCount,
    activity.pausedCount,
    activity.queuedCount,
    hasActivity,
    t,
  ]);

  const accessibilityLabel = hasActivity
    ? `${t('home.activeDownloads')}. ${summary}`
    : `${t('home.activeDownloads')}. ${t('home.noActiveDownloads')}`;

  return (
    <Box
      px={16}
      testID="home-active-downloads"
      style={{ paddingTop: layout.sectionTop }}>
      <Pressable
        onPress={openDownloads}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={t('home.viewDownloadsA11y')}
        testID="home-active-downloads-card"
        style={({ pressed }) => ({
          opacity: pressed ? 0.94 : 1,
          transform: [{ scale: pressed ? 0.995 : 1 }],
        })}>
        <Card elevation="sm" padding={12}>
          <Box gap={8}>
            <Box row rtlRow center style={{ justifyContent: 'space-between' }}>
              <Box row rtlRow center gap={8} style={{ minWidth: 0, flex: 1 }}>
                <Icon name="download-outline" size="sm" color="primary" />
                <Text variant="bodySmall" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {t('home.activeDownloads')}
                </Text>
              </Box>
              <Text variant="caption" color="primary">
                {t('home.viewAll')}
              </Text>
            </Box>
            <Text
              variant="caption"
              color="textSecondary"
              style={{ opacity: hasActivity ? 1 : 0.85 }}>
              {summary}
            </Text>
            {activity.activeCount > 0 ? (
              <ProgressBar
                progress={activity.averageProgress / 100}
                style={{ height: layout.progressHeight }}
                accessibilityLabel={t('home.averageProgressA11y', {
                  percent: activity.averageProgress,
                })}
              />
            ) : null}
          </Box>
        </Card>
      </Pressable>
    </Box>
  );
});
