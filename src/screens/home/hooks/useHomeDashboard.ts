import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import {
  useContinueWatchingQuery,
  useRecentPlaybackQuery,
} from '@/playback/hooks';
import { PLAYBACK_LOCAL_NAMESPACE } from '@/playback/constants';
import { playbackQueryKeys } from '@/playback/query-keys';
import { buildHomeStorageSummary } from '@/storage-manager';
import {
  deriveDownloadActivitySummary,
  selectCompletedCatalogSignature,
  selectCompletedDownloads,
  selectDownloadActivitySignature,
  selectDownloadsInitialized,
  selectDownloadsLoading,
  selectManagedStorageBytesSignature,
  useDownloadsStore,
} from '@/store/downloads';
import { useTranslation } from '@/localization';

import { HOME_SECTION_LIMIT } from '../constants/home.constants';
import {
  deriveContinueWatchingTiles,
  deriveRecentDownloadTiles,
  deriveRecentlyWatchedTiles,
  type HomeLocalFileMeta,
  type HomeMediaTile,
} from '../utils/home-derive';
import {
  loadHomeLocalFileIndex,
  readAvailableDiskBytes,
} from '../utils/home-local-index';

export function useHomeDownloadHydration() {
  const initialized = useDownloadsStore(selectDownloadsInitialized);
  const loading = useDownloadsStore(selectDownloadsLoading);
  const load = useDownloadsStore((state) => state.load);

  useEffect(() => {
    if (!initialized && !loading) {
      void load(1);
    }
  }, [initialized, loading, load]);
}

export function useHomeLocalFileIndex(): {
  localById: Record<string, HomeLocalFileMeta>;
  ready: boolean;
  reload: () => Promise<void>;
} {
  const [localById, setLocalById] = useState<Record<string, HomeLocalFileMeta>>(
    {},
  );
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    const next = await loadHomeLocalFileIndex();
    setLocalById(next);
    setReady(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { localById, ready, reload };
}

export function useHomeGreeting() {
  const { t } = useTranslation();

  return useMemo(
    () => ({
      headline: t('home.greetingWelcome'),
    }),
    [t],
  );
}

export function useHomeDownloadActivity() {
  const signature = useDownloadsStore(selectDownloadActivitySignature);

  return useMemo(() => {
    void signature;
    return deriveDownloadActivitySummary(useDownloadsStore.getState());
  }, [signature]);
}

export function useHomeRecentDownloads(
  localById: Record<string, HomeLocalFileMeta>,
  localReady: boolean,
): { items: HomeMediaTile[]; isLoading: boolean } {
  const signature = useDownloadsStore(selectCompletedCatalogSignature);
  const initialized = useDownloadsStore(selectDownloadsInitialized);
  const loading = useDownloadsStore(selectDownloadsLoading);
  const { language } = useTranslation();

  const items = useMemo(() => {
    void signature;
    void language;
    const completed = selectCompletedDownloads(useDownloadsStore.getState());
    return deriveRecentDownloadTiles(completed, localById, HOME_SECTION_LIMIT);
  }, [language, localById, signature]);

  const isLoading =
    items.length === 0 && ((!initialized && loading) || !localReady);

  return { items, isLoading };
}

export function useHomeContinueWatching(
  localById: Record<string, HomeLocalFileMeta>,
): { items: HomeMediaTile[]; isLoading: boolean } {
  const continueQuery = useContinueWatchingQuery();
  const catalogSignature = useDownloadsStore(selectCompletedCatalogSignature);
  const { language } = useTranslation();

  const items = useMemo(() => {
    void catalogSignature;
    void language;
    const itemsById = useDownloadsStore.getState().itemsById;
    return deriveContinueWatchingTiles(
      continueQuery.items,
      itemsById,
      localById,
      HOME_SECTION_LIMIT,
    );
  }, [catalogSignature, continueQuery.items, language, localById]);

  return {
    items,
    isLoading: items.length === 0 && continueQuery.isLoading,
  };
}

export function useHomeRecentlyWatched(
  localById: Record<string, HomeLocalFileMeta>,
): { items: HomeMediaTile[]; isLoading: boolean } {
  const recentQuery = useRecentPlaybackQuery(50);
  const catalogSignature = useDownloadsStore(selectCompletedCatalogSignature);
  const { language } = useTranslation();

  const items = useMemo(() => {
    void catalogSignature;
    void language;
    const itemsById = useDownloadsStore.getState().itemsById;
    return deriveRecentlyWatchedTiles(
      recentQuery.items,
      itemsById,
      localById,
      HOME_SECTION_LIMIT,
    );
  }, [catalogSignature, language, localById, recentQuery.items]);

  return {
    items,
    isLoading: items.length === 0 && recentQuery.isLoading,
  };
}

export function useHomeStorageSummary(
  localById: Record<string, HomeLocalFileMeta>,
) {
  const bytesSignature = useDownloadsStore(selectManagedStorageBytesSignature);
  const [availableBytes, setAvailableBytes] = useState<number | null>(null);
  const [availabilityKnown, setAvailabilityKnown] = useState(false);

  const refreshDisk = useCallback(() => {
    setAvailableBytes(readAvailableDiskBytes());
    setAvailabilityKnown(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshDisk();
    }, [refreshDisk]),
  );

  const usedSummary = useMemo(() => {
    void bytesSignature;
    const completed = selectCompletedDownloads(useDownloadsStore.getState());
    return buildHomeStorageSummary({
      completed,
      localById,
      freeBytes: availableBytes,
    });
  }, [availableBytes, bytesSignature, localById]);

  return {
    usedLabel: usedSummary.usedLabel,
    freeLabel: usedSummary.freeLabel,
    usageRatio: usedSummary.usageRatio,
    unavailable: availabilityKnown && usedSummary.unavailable,
    refreshDisk,
  };
}

export function useHomeRefresh(
  reloadLocal: () => Promise<void>,
  refreshDisk: () => void,
) {
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const refreshDownloads = useDownloadsStore((state) => state.refresh);
  const queryClient = useQueryClient();

  const onRefresh = useCallback(async () => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setRefreshing(true);
    try {
      await Promise.allSettled([
        refreshDownloads(),
        queryClient.invalidateQueries({
          queryKey: playbackQueryKeys.continueWatching(PLAYBACK_LOCAL_NAMESPACE),
          refetchType: 'active',
        }),
        queryClient.invalidateQueries({
          queryKey: playbackQueryKeys.recent(PLAYBACK_LOCAL_NAMESPACE),
          refetchType: 'active',
        }),
        reloadLocal(),
      ]);
      refreshDisk();
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [queryClient, refreshDisk, refreshDownloads, reloadLocal]);

  return { refreshing, onRefresh };
}
