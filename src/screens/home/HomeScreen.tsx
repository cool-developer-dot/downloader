import { memo, useCallback } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { SafeAreaScreen } from '@/components/common/SafeAreaScreen';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/localization';
import { useQualitySelectionContext } from '@/screens/downloads/quality';

import {
  HomeActiveDownloads,
  HomeContinueWatching,
  HomeHeader,
  HomePrimaryActions,
  HomeQuickAccess,
  HomeRecentDownloads,
  HomeRecentlyWatched,
  HomeStorageSummary,
} from './components';
import {
  useHomeDownloadHydration,
  useHomeLocalFileIndex,
  useHomeRefresh,
  useHomeStorageSummary,
} from './hooks/useHomeDashboard';

/**
 * Legacy Home dashboard. Not mounted as a landing tab.
 * Phase 1 keeps `/` as a Browser redirect; overflow shortcuts route
 * secondary content to Downloads / Library / Settings instead.
 * Shared derive/storage helpers remain for Storage Manager and verifiers.
 */
export const HomeScreen = memo(function HomeScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  useHomeDownloadHydration();
  const { localById, ready, reload } = useHomeLocalFileIndex();
  const storage = useHomeStorageSummary(localById);
  const { refreshing, onRefresh } = useHomeRefresh(reload, storage.refreshDisk);
  const qualitySelection = useQualitySelectionContext();

  const handleRefresh = useCallback(() => {
    void onRefresh();
  }, [onRefresh]);

  return (
    <SafeAreaScreen
      testID="home-screen"
      padded={false}
      edges={['top', 'left', 'right']}
      style={{ backgroundColor: theme.colors.background }}>
      <HomeHeader />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingBottom: theme.spacing[32],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.primary}
            colors={[theme.colors.primary]}
            accessibilityLabel={t('home.refreshA11y')}
          />
        }>
        <HomePrimaryActions onPasteLink={qualitySelection.open} />
        <HomeQuickAccess />
        <HomeActiveDownloads />
        <HomeRecentDownloads localById={localById} localReady={ready} />
        <HomeContinueWatching localById={localById} />
        <HomeRecentlyWatched localById={localById} />
        <HomeStorageSummary
          usedLabel={storage.usedLabel}
          freeLabel={storage.freeLabel}
          usageRatio={storage.usageRatio}
          unavailable={storage.unavailable}
        />
      </ScrollView>
    </SafeAreaScreen>
  );
});
