import type { RoutePath } from '@/navigation/constants/route-paths';
import { resolveInitialRoute } from '@/navigation/helpers/resolve-initial-route';
import {
  setLanguage,
  setPreferences,
  setThemeMode,
} from '@/storage/mmkv';
import { initializeSqlite } from '@/storage/sqlite';
import { useAppStore, useSettingsStore, useThemeStore } from '@/store';
import { applyNativeColorScheme } from '@/theme/apply-native-color-scheme';
import { normalizeThemePreference } from '@/theme/theme-preference';
import { bindLanguageReader } from '@/localization/translate';

import { cleanupObsoleteAuthSecrets } from './cleanup-obsolete-auth';
import { logOnboardingPersistSnapshot } from './onboarding-persist-debug';
import { rehydrateAndWait, waitForStoresHydration } from './wait-for-hydration';
import { syncAppStoreFromDisk } from '@/store/app/persist-sync';

function syncMmkvFromStores(): void {
  const themeMode = normalizeThemePreference(useThemeStore.getState().themeMode);
  const settings = useSettingsStore.getState();

  if (useThemeStore.getState().themeMode !== themeMode) {
    useThemeStore.setState({ themeMode });
  }

  bindLanguageReader(() => useSettingsStore.getState().language);
  setThemeMode(themeMode);
  applyNativeColorScheme(themeMode);
  setLanguage(settings.language);
  setPreferences({
    wifiOnly: settings.wifiOnly,
    autoResume: settings.autoResume,
    notifications: settings.notifications,
    downloadDirectory: settings.downloadDirectory,
    maxConcurrentDownloads: settings.maxConcurrentDownloads,
  });
}

export async function runAppInitializer(): Promise<RoutePath> {
  const appStore = useAppStore.getState();

  appStore.setLoading(true);

  try {
    const [, sqliteResult] = await Promise.all([
      Promise.all([
        rehydrateAndWait(useAppStore),
        waitForStoresHydration([useThemeStore, useSettingsStore]),
      ]),
      initializeSqlite(),
    ]);

    await syncAppStoreFromDisk();
    await logOnboardingPersistSnapshot('bootstrap-after-sync');

    await rehydrateAndWait(useSettingsStore);

    try {
      const { hydrateDownloadSettings } = await import(
        '@/downloads/settings'
      );
      hydrateDownloadSettings();
    } catch (error) {
      if (__DEV__) {
        console.warn('[bootstrap] download settings hydrate failed', error);
      }
    }

    syncMmkvFromStores();

    await Promise.all([
      (async () => {
        try {
          const { migratePlaybackKeysToLocalNamespace } = await import(
            '@/playback/persistence'
          );
          migratePlaybackKeysToLocalNamespace();
        } catch (error) {
          if (__DEV__) {
            console.warn('[bootstrap] playback namespace migration failed', error);
          }
        }
      })(),
      (async () => {
        try {
          await cleanupObsoleteAuthSecrets();
        } catch (error) {
          if (__DEV__) {
            console.warn('[bootstrap] obsolete auth cleanup failed', error);
          }
        }
      })(),
    ]);

    if (!sqliteResult.ready && __DEV__) {
      console.warn(
        '[bootstrap] Local SQLite unavailable:',
        sqliteResult.error?.message ?? 'unknown error',
      );
    }

    try {
      const { ensureDownloadCatalogSeeded } = await import(
        '@/storage/services/catalog-seed.service'
      );
      const { refreshFavoriteMediaIdCache } = await import(
        '@/storage/services/catalog-persist'
      );
      const { useDownloadsStore } = await import('@/store/downloads');
      const { useFoldersStore } = await import('@/store/organization/folders');
      const { catalogEntryToDownloadItem, downloadCatalogRepository } =
        await import('@/storage/repositories');

      const folderSnap = Object.values(useFoldersStore.getState().itemsById);
      await ensureDownloadCatalogSeeded({
        storeItems: Object.values(useDownloadsStore.getState().itemsById),
        folderSnapshots: folderSnap.map((folder) => ({
          id: folder.id,
          name: folder.name,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
        })),
      });
      await refreshFavoriteMediaIdCache();

      try {
        const page = await downloadCatalogRepository.list({
          page: 1,
          limit: 50,
          sort: 'newest',
        });
        useDownloadsStore.getState().applyPage(
          page.items.map(catalogEntryToDownloadItem),
          {
            total: page.total,
            page: page.page,
            pageSize: page.pageSize,
            hasMore: page.hasMore,
          },
          false,
        );
      } catch {
        // non-fatal
      }
    } catch (seedError) {
      if (__DEV__) {
        console.warn('[bootstrap] catalog seed failed', seedError);
      }
    }

    try {
      const { bindDownloadEngineToStore } = await import(
        '@/downloads/bind-engine-to-store'
      );
      const { downloadEngine } = await import('@/downloads/engine');
      const { ensureDownloadRecoveryListener } = await import(
        '@/downloads/ensure-recovery-listener'
      );
      const { downloadAppLifecycle } = await import('@/downloads/execution');
      const { ensureDownloadNotificationBridge } = await import(
        '@/downloads/notifications'
      );
      const { ensureLibraryCompletionBridge } = await import(
        '@/library/ensure-completion-bridge'
      );
      downloadAppLifecycle.ensureAttached();
      bindDownloadEngineToStore();
      ensureDownloadRecoveryListener();
      ensureDownloadNotificationBridge();
      if (typeof ensureLibraryCompletionBridge === 'function') {
        ensureLibraryCompletionBridge();
      }
      void downloadEngine.recover();

      try {
        const { bindPlaybackPersistence } = await import(
          '@/playback/bind-playback-persistence'
        );
        if (typeof bindPlaybackPersistence === 'function') {
          bindPlaybackPersistence();
        }
      } catch (playbackError) {
        if (__DEV__) {
          console.warn(
            '[bootstrap] playback persistence bind failed',
            playbackError,
          );
        }
      }

      try {
        const { reconcilePendingExports } = await import(
          '@/downloads/completed-file/export/export-service'
        );
        await reconcilePendingExports();
      } catch (exportError) {
        if (__DEV__) {
          console.warn('[bootstrap] pending export reconcile failed', exportError);
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.warn('[bootstrap] download engine init failed', error);
      }
    }

    appStore.initialize();

    return resolveInitialRoute();
  } finally {
    appStore.setLoading(false);
  }
}
