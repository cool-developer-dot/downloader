import { memo, useCallback } from 'react';
import { ActivityIndicator } from 'react-native';

import { Box } from '@/components/base/Box';
import { Text } from '@/components/base/Text';
import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useStorageManager } from '@/storage-manager';

import {
  StorageActions,
  StorageBreakdown,
  StorageLocationCard,
  StorageOverviewCard,
  StorageSectionHeader,
} from './components';

export const StorageScreen = memo(function StorageScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { snapshot, loading, refreshing, clearingCache, error, refresh, clearCache } =
    useStorageManager();

  const handleRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const handleClearCache = useCallback(() => {
    void clearCache();
  }, [clearCache]);

  return (
    <SafeAreaScreen
      testID="storage-screen"
      scrollable
      padded={false}
      refreshing={refreshing}
      onRefresh={handleRefresh}
      edges={['bottom', 'left', 'right']}
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={{
        paddingHorizontal: theme.spacing[16],
        paddingTop: theme.spacing[12],
        paddingBottom: theme.spacing[32],
        gap: theme.spacing[20],
      }}>
      <StorageSectionHeader
        title={t('storage.title')}
        subtitle={t('storage.subtitle')}
        testID="storage-header"
      />

      {loading && !snapshot ? (
        <Box center py={32} gap={12} testID="storage-loading">
          <ActivityIndicator color={theme.colors.primary} />
          <Text variant="caption" color="textSecondary">
            {t('storage.loading')}
          </Text>
        </Box>
      ) : null}

      {error && !snapshot ? (
        <Box center py={24} testID="storage-error">
          <Text variant="bodySmall" color="textSecondary" align="center">
            {t('storage.loadFailed')}
          </Text>
        </Box>
      ) : null}

      {snapshot ? (
        <>
          <StorageOverviewCard device={snapshot.device} />

          <Box gap={12}>
            <StorageSectionHeader title={t('storage.appUsageSection')} />
            <StorageBreakdown breakdown={snapshot.app} />
          </Box>

          <Box gap={12}>
            <StorageSectionHeader
              title={t('storage.locationsSection')}
              subtitle={t('storage.locationsSubtitle')}
            />
            <Box gap={8}>
              {snapshot.locations.map((location) => (
                <StorageLocationCard key={location.id} location={location} />
              ))}
            </Box>
          </Box>

          <Box gap={12}>
            <StorageSectionHeader title={t('storage.actionsSection')} />
            <StorageActions
              onRefresh={handleRefresh}
              onClearCache={handleClearCache}
              refreshing={refreshing}
              clearingCache={clearingCache}
            />
          </Box>
        </>
      ) : null}
    </SafeAreaScreen>
  );
});
