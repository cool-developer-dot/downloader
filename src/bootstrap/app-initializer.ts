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

/** The one-time favorites migration waits for startup to settle. */
const FAVORITES_MIGRATION_DELAY_MS = 4_000;

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

  try {
    // Nothing may change the app store before it is hydrated: zustand's persist writes the *current* slice on
    // every set, so a pre-hydration write replaces the persisted `onboardingComplete` with the default `false`
    // and the intro plays again on every launch.
    const [, sqliteResult] = await Promise.all([
      Promise.all([
        rehydrateAndWait(useAppStore),
        waitForStoresHydration([useThemeStore, useSettingsStore]),
      ]),
      initializeSqlite(),
    ]);

    await syncAppStoreFromDisk();
    appStore.setLoading(true);
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
      const { ensureV2DownloadBridge } = await import('@/downloads/v2/ensure-bridge');
      // Mirrors the v2 DownloadEngine (its records and library items) into the downloads store.
      ensureV2DownloadBridge();
      const { ensureV2ProgressStats } = await import('@/downloads/v2/progress-stats-store');
      // Average speed, active time and the speed graph of v2 downloads (in memory, this session only).
      ensureV2ProgressStats();
      const { ensureFavoritesMigration } = await import('@/library/ensure-favorites-migration');
      // One-time: legacy favorites onto the library items they unambiguously name. Off the startup path.
      setTimeout(ensureFavoritesMigration, FAVORITES_MIGRATION_DELAY_MS);
      const { ensureAfterDownloadAction } = await import('@/downloads/v2/ensure-after-download');
      // Download Settings → After a download finishes (default: do nothing).
      ensureAfterDownloadAction();
      const { ensureIncomingLinkHandling } = await import('@/browser/services/incoming-link.service');
      // A link shared to VidoraX, or opened through it as the device's browser, lands in the browser tab.
      ensureIncomingLinkHandling();
      const { ensureFilenameNaming } = await import('@/downloads/v2/ensure-filename-naming');
      // Download Settings → File naming applies to new downloads (the default keeps titles unchanged).
      ensureFilenameNaming();
      const { ensureDownloadOptions } = await import('@/downloads/v2/download-options-store');
      // Quality sheet → Options: name, folder, per-download Save to Gallery (nothing changes unless used).
      ensureDownloadOptions();
      downloadAppLifecycle.ensureAttached();
      const { ensureDefaultTab } = await import('@/navigation/helpers/ensure-default-tab');
      // Settings → Default tab: where the splash lands a returning user (Browser unless changed).
      ensureDefaultTab();
      bindDownloadEngineToStore();
      const { ensureSaveLocationCopies } = await import('@/downloads/v2/ensure-save-location');
      // Download Settings → Save location: an extra copy of new downloads in a picked folder (off by default).
      ensureSaveLocationCopies();
      ensureDownloadRecoveryListener();
      const { ensureDataUsageCounting } = await import('@/downloads/v2/ensure-data-usage');
      // Settings → Storage → Data usage: counts v2 download bytes (limits off by default; never pauses downloads).
      ensureDataUsageCounting();
      ensureDownloadNotificationBridge();
      const { ensureClipboardLinkMonitor } = await import('@/browser/services/clipboard-link-monitor');
      // Download Settings → Copied links: only when on (default off), only on returning to the foreground.
      ensureClipboardLinkMonitor();
      if (typeof ensureLibraryCompletionBridge === 'function') {
        ensureLibraryCompletionBridge();
      }
      const { cleanUpPrivateVault } = await import('@/private-vault/vault-port');
      // Private: playback files and half-written vault files an earlier run left behind are deleted.
      cleanUpPrivateVault();
      void downloadEngine.recover();
      const { ensureDebugLogs } = await import('@/diagnostics/ensure-debug-logs');
      // Download Settings → History & logs → Debug logs (off by default; in memory only).
      ensureDebugLogs();

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
      const { ensureMediaTagCleanup } = await import('@/media-edit/ensure-media-tags');
      // Edit after download: an item's artist tag goes with it when it is deleted.
      ensureMediaTagCleanup();

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
      const { ensureDuplicateReplacements } = await import('@/downloads/v2/ensure-duplicate-replacements');
      // Duplicate Action → Replace: the old copy goes once its new copy completed (nothing pending by default).
      ensureDuplicateReplacements();
      const { ensureItemOrganizeCleanup } = await import('@/library/item-organize-store');
      // A saved video's tags and note go with it when it is deleted.
      ensureItemOrganizeCleanup();
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
