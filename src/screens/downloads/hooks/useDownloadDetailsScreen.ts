import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { isApiError } from '@/api';
import {
  downloadEngine,
  DownloadEngineError,
} from '@/downloads/engine';
import { completedActionErrorMessageKey } from '@/downloads/completed-file/action-errors';
import { getV2Engine, pageFavoriteChange, setEngineFavorite } from '@/downloads/v2';
import { translate, type TranslationKey } from '@/localization';
import { navigation, routePaths } from '@/navigation';
import { useDownloadsStore } from '@/store/downloads';
import {
  normalizeFavoriteSourceKey,
  useFavoritesStore,
} from '@/store/favorites';

import {
  canOpenOrShareCompletedFile,
  getPrimaryAction,
  getSupportedActions,
  type DownloadCardAction,
} from '../utils/download-format';

function localizeCompletedActionError(
  code: Parameters<typeof completedActionErrorMessageKey>[0],
): string {
  return translate(completedActionErrorMessageKey(code) as TranslationKey);
}

function resolveIdParam(raw: string | string[] | undefined): string | null {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return decodeURIComponent(raw.trim());
    } catch {
      return raw.trim();
    }
  }

  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) {
    try {
      return decodeURIComponent(raw[0].trim());
    } catch {
      return raw[0].trim();
    }
  }

  return null;
}

export function useDownloadDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const downloadId = resolveIdParam(params.id);

  const item = useDownloadsStore((state) =>
    downloadId ? state.itemsById[downloadId] : undefined,
  );
  const transfer = useDownloadsStore((state) =>
    downloadId ? state.transferById[downloadId] ?? null : null,
  );
  const mutating = useDownloadsStore((state) =>
    downloadId ? Boolean(state.mutatingIds[downloadId]) : false,
  );
  const fetchOne = useDownloadsStore((state) => state.fetchOne);
  const pause = useDownloadsStore((state) => state.pause);
  const resume = useDownloadsStore((state) => state.resume);
  const cancel = useDownloadsStore((state) => state.cancel);
  const retry = useDownloadsStore((state) => state.retry);
  const remove = useDownloadsStore((state) => state.remove);

  const [bootstrapping, setBootstrapping] = useState(!item && Boolean(downloadId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

  const sourceUrl = item?.sourceUrl ?? '';
  const sourceKey = sourceUrl ? normalizeFavoriteSourceKey(sourceUrl) : '';
  const pageFavorited = useFavoritesStore((state) =>
    sourceKey ? Boolean(state.urlIndex[sourceKey]) : false,
  );
  const pagePending = useFavoritesStore((state) =>
    sourceKey ? Boolean(state.pendingUrls[sourceKey]) : false,
  );
  // A finished v2 video has a favorite of its own; a v1 row's favorite is its page's.
  const ownFavorite = useDownloadsStore((state) =>
    downloadId ? state.engineRowsById[downloadId]?.favorite : undefined,
  );
  const [ownPending, setOwnPending] = useState(false);
  const isFavorited = typeof ownFavorite === 'boolean' ? ownFavorite : pageFavorited;
  const favoritePending = pagePending || ownPending;
  const ensureFavoritesReady = useFavoritesStore((state) => state.ensureReady);
  const resolveFavoriteForUrl = useFavoritesStore(
    (state) => state.resolveFavoriteForUrl,
  );
  const toggleFavorite = useFavoritesStore((state) => state.toggleOptimistic);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!downloadId) {
        setMissing(true);
        setBootstrapping(false);
        return;
      }

      if (item) {
        setBootstrapping(false);
        setMissing(false);
        setLoadError(null);
        // Still soft-refresh from API via fetchOne.
        void fetchOne(downloadId);
        return;
      }

      setBootstrapping(true);
      setLoadError(null);
      setMissing(false);

      try {
        const result = await fetchOne(downloadId);

        if (cancelled) {
          return;
        }

        if (result) {
          setMissing(false);
          setLoadError(null);
        } else {
          setMissing(true);
          setLoadError(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setMissing(false);
        setLoadError(
          isApiError(error)
            ? error.message
            : 'Something went wrong while loading this download.',
        );
      } finally {
        if (!cancelled) {
          setBootstrapping(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id-driven bootstrap
  }, [downloadId, fetchOne]);

  useEffect(() => {
    if (!sourceUrl) {
      return;
    }

    let cancelled = false;

    async function hydrateFavorite() {
      await ensureFavoritesReady();
      if (cancelled) {
        return;
      }

      const state = useFavoritesStore.getState();
      if (state.isUrlFavorited(sourceUrl)) {
        return;
      }

      // Full unfiltered set already loaded — absence means not favorited.
      if (state.ready && !state.query && !state.hasMore) {
        return;
      }

      await resolveFavoriteForUrl(sourceUrl);
    }

    void hydrateFavorite();

    return () => {
      cancelled = true;
    };
  }, [ensureFavoritesReady, resolveFavoriteForUrl, sourceUrl]);

  const localMedia = useMemo(
    () => ({
      localUri:
        transfer?.localUri ??
        (downloadId ? downloadEngine.getLocalUri(downloadId) : null),
      localState: transfer?.localState ?? null,
      executionState: transfer?.executionState ?? null,
      workerState: item?.workerState ?? transfer?.workerState ?? null,
      supportsResume: transfer?.supportsResume ?? null,
      errorCode: item?.errorCode ?? null,
    }),
    [downloadId, item?.workerState, item?.errorCode, transfer],
  );

  const primaryAction = useMemo(
    () =>
      item
        ? getPrimaryAction(item.status, item.sourceUrl, localMedia)
        : null,
    [item, localMedia],
  );

  const secondaryActions = useMemo(() => {
    if (!item || !primaryAction) {
      return [] as DownloadCardAction[];
    }
    return getSupportedActions(item.status, item.sourceUrl, localMedia).filter(
      (action) => action !== primaryAction,
    );
  }, [item, localMedia, primaryAction]);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.back();
      return;
    }
    navigation.replace('/downloads');
  }, []);

  const canUseLocalFile = useMemo(() => {
    if (!item) {
      return false;
    }
    return canOpenOrShareCompletedFile(item.status, localMedia);
  }, [item, localMedia]);

  const onShareFile = useCallback(async () => {
    if (!downloadId || !item) {
      return;
    }
    setActionError(null);
    try {
      const { shareCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await shareCompletedFile(downloadId);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch (error) {
      setActionError(
        error instanceof DownloadEngineError
          ? error.message
          : translate('files.unavailable'),
      );
    }
  }, [downloadId, item]);

  const onOpenFile = useCallback(async () => {
    if (!downloadId || !item) {
      return;
    }
    setActionError(null);
    try {
      const { openCompletedFile } = await import(
        '@/downloads/completed-file/action-service'
      );
      const result = await openCompletedFile(downloadId);
      if (!result.ok) {
        setActionError(localizeCompletedActionError(result.error.code));
      }
    } catch (error) {
      setActionError(
        error instanceof DownloadEngineError
          ? error.message
          : translate('files.unavailable'),
      );
    }
  }, [downloadId, item]);

  const runAction = useCallback(
    async (action: DownloadCardAction) => {
      if (!downloadId) {
        return;
      }

      setActionError(null);

      if (action === 'remove') {
        setDeleteVisible(true);
        return;
      }

      let result = null;
      if (action === 'pause') {
        result = await pause(downloadId);
        if (!result) {
          const storeError = useDownloadsStore.getState().error;
          setActionError(storeError?.trim() || 'Couldn’t pause this download.');
        }
        return;
      }
      if (action === 'resume') {
        result = await resume(downloadId);
        if (!result) {
          const storeError = useDownloadsStore.getState().error;
          setActionError(
            storeError?.trim() || 'Unable to resume this download.',
          );
        }
        return;
      }
      if (action === 'cancel') {
        result = await cancel(downloadId);
        if (!result) {
          setActionError('Couldn’t cancel this download.');
        }
        return;
      }
      if (action === 'retry') {
        result = await retry(downloadId);
        if (!result) {
          const storeError = useDownloadsStore.getState().error;
          setActionError(
            storeError?.trim() || 'Unable to retry this download.',
          );
        }
        return;
      }
      if (action === 'open') {
        await onOpenFile();
        return;
      }
      if (action === 'share') {
        await onShareFile();
      }
    },
    [cancel, downloadId, onOpenFile, onShareFile, pause, resume, retry],
  );

  const confirmDelete = useCallback(async () => {
    if (!downloadId) {
      return;
    }

    setDeleting(true);
    setActionError(null);
    try {
      // Local cleanup → catalog delete → store eviction (no VidoraX API).
      const ok = await remove(downloadId);
      if (ok) {
        setDeleteVisible(false);
        goBack();
        return;
      }
      setDeleteVisible(false);
      setActionError(
        useDownloadsStore.getState().error?.trim() ||
          'Couldn’t remove this download.',
      );
    } catch (error) {
      setDeleteVisible(false);
      const message = isApiError(error)
        ? error.message
        : 'Couldn’t remove this download.';
      setActionError(message);
    } finally {
      setDeleting(false);
    }
  }, [downloadId, goBack, remove]);

  const cancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setDeleteVisible(false);
  }, [deleting]);

  const onFavoritePress = useCallback(async () => {
    if (!downloadId || !item?.sourceUrl || favoritePending) {
      return;
    }

    setFavoriteError(null);

    const toggleInput = {
      mediaId: downloadId,
      title: item.title || item.fileName || item.sourceUrl,
      platform: item.platform,
      sourceUrl: item.sourceUrl,
      thumbnailUrl: item.thumbnailUrl,
    };

    if (typeof ownFavorite === 'boolean') {
      // Only this video changes; its siblings from the same page keep their own favorites.
      const favorite = !ownFavorite;
      setOwnPending(true);
      try {
        await setEngineFavorite(getV2Engine(), downloadId, favorite);
        const rows = Object.values(useDownloadsStore.getState().engineRowsById);
        const otherFavoritesOnPage = rows.filter(
          (row) =>
            row.id !== downloadId &&
            row.favorite === true &&
            normalizeFavoriteSourceKey(row.sourceUrl) === sourceKey,
        ).length;
        // The Favorites screen lists pages: keep the page there while any of its videos is a favorite.
        if (pageFavoriteChange({ favorite, pageFavorited, otherFavoritesOnPage })) {
          const result = await toggleFavorite(toggleInput);
          if (result.error) {
            setFavoriteError(result.error);
          }
        }
      } catch {
        setFavoriteError(translate('downloads.detailsFavoriteErrorTitle' as TranslationKey));
      } finally {
        setOwnPending(false);
      }
      return;
    }

    const result = await toggleFavorite(toggleInput);

    if (result.error) {
      setFavoriteError(result.error);
    }
  }, [downloadId, favoritePending, item, ownFavorite, pageFavorited, sourceKey, toggleFavorite]);

  const dismissFavoriteError = useCallback(() => {
    setFavoriteError(null);
  }, []);

  useEffect(() => {
    if (!downloadId || item?.status !== 'COMPLETED') {
      return;
    }
    void downloadEngine.refreshCompletedLocalFile(downloadId);
  }, [downloadId, item?.status]);

  const openFavorites = useCallback(() => {
    navigation.push(routePaths.favorites);
  }, []);

  const retryLoad = useCallback(async () => {
    if (!downloadId) {
      return;
    }
    setBootstrapping(true);
    setLoadError(null);
    setMissing(false);
    try {
      const result = await fetchOne(downloadId);
      if (!result) {
        setMissing(true);
      }
    } catch (error) {
      setLoadError(
        isApiError(error)
          ? error.message
          : 'Something went wrong while loading this download.',
      );
    } finally {
      setBootstrapping(false);
    }
  }, [downloadId, fetchOne]);

  const status = useMemo(() => {
    if (!downloadId) {
      return 'missing' as const;
    }
    if (bootstrapping && !item) {
      return 'loading' as const;
    }
    if (item) {
      return 'ready' as const;
    }
    if (loadError) {
      return 'error' as const;
    }
    if (missing) {
      return 'missing' as const;
    }
    return 'loading' as const;
  }, [bootstrapping, downloadId, item, loadError, missing]);

  return {
    downloadId,
    item,
    status,
    loadError,
    actionError,
    mutating,
    primaryAction,
    secondaryActions,
    deleteVisible,
    deleting,
    isFavorited,
    favoritePending,
    favoriteError,
    canUseLocalFile,
    goBack,
    runAction,
    confirmDelete,
    cancelDelete,
    onFavoritePress,
    dismissFavoriteError,
    openFavorites,
    retryLoad,
  };
}

export type DownloadDetailsScreenModel = ReturnType<typeof useDownloadDetailsScreen>;
