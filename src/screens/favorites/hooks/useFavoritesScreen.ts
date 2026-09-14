import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { downloadDetailsPath, navigation, routePaths } from '@/navigation';
import { useFavorites } from '@/storage/hooks';
import { downloadCatalogRepository, catalogEntryToDownloadItem } from '@/storage/repositories';
import {
  normalizeFavoriteSourceKey,
  type FavoriteItem,
} from '@/store/favorites';
import { useDownloadsStore } from '@/store/downloads';

import { SEARCH_DEBOUNCE_MS } from '../constants/favorites.constants';

function findDownloadIdInStore(sourceUrl: string): string | null {
  const key = normalizeFavoriteSourceKey(sourceUrl);
  if (!key) {
    return null;
  }

  const { itemsById } = useDownloadsStore.getState();
  for (const item of Object.values(itemsById)) {
    if (normalizeFavoriteSourceKey(item.sourceUrl) === key) {
      return item.id;
    }
  }

  return null;
}

async function resolveDownloadIdForFavorite(
  sourceUrl: string,
): Promise<string | null> {
  const cached = findDownloadIdInStore(sourceUrl);
  if (cached) {
    return cached;
  }

  try {
    const response = await downloadCatalogRepository.list({
      search: sourceUrl.trim(),
      limit: 20,
      sort: 'newest',
    });

    const key = normalizeFavoriteSourceKey(sourceUrl);
    const match = response.items.find(
      (item) => normalizeFavoriteSourceKey(item.sourceUrl) === key,
    );

    if (match) {
      useDownloadsStore
        .getState()
        .upsertItem(catalogEntryToDownloadItem(match));
      return match.id;
    }
  } catch {
    // Fall through to unavailable.
  }

  return null;
}

export function useFavoritesScreen() {
  const {
    orderedIds,
    itemsById,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    ready,
    initialized,
    load,
    refresh,
    loadMore,
    search,
    remove,
  } = useFavorites({ autoLoad: true });

  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [unavailableIds, setUnavailableIds] = useState<Record<string, boolean>>(
    {},
  );
  const [openError, setOpenError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvingRef = useRef<Record<string, boolean>>({});

  const status = useMemo(() => {
    if (!initialized && loading && orderedIds.length === 0) {
      return 'loading' as const;
    }

    if (error && orderedIds.length === 0 && !initialized) {
      return 'error' as const;
    }

    if ((ready || initialized) && orderedIds.length === 0 && !searchDraft.trim()) {
      return 'empty' as const;
    }

    if ((ready || initialized) && orderedIds.length === 0 && searchDraft.trim()) {
      return 'empty-search' as const;
    }

    return 'ready' as const;
  }, [error, initialized, loading, orderedIds.length, ready, searchDraft]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const onChangeSearch = useCallback(
    (value: string) => {
      setSearchDraft(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        void search(value.trim());
      }, SEARCH_DEBOUNCE_MS);
    },
    [search],
  );

  const onSubmitSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      const trimmed = value.trim();
      setSearchDraft(trimmed);
      void search(trimmed);
    },
    [search],
  );

  const openEntry = useCallback(async (item: FavoriteItem) => {
    if (resolvingRef.current[item.id]) {
      return;
    }

    setOpenError(null);
    resolvingRef.current[item.id] = true;

    try {
      const downloadId = await resolveDownloadIdForFavorite(item.sourceUrl);

      if (!downloadId) {
        setUnavailableIds((current) => ({ ...current, [item.id]: true }));
        return;
      }

      setUnavailableIds((current) => {
        if (!current[item.id]) {
          return current;
        }
        const next = { ...current };
        delete next[item.id];
        return next;
      });

      navigation.push(downloadDetailsPath(downloadId));
    } catch {
      setOpenError('Couldn’t open this favorite.');
    } finally {
      delete resolvingRef.current[item.id];
    }
  }, []);

  const requestRemove = useCallback((id: string) => {
    setRemoveTargetId(id);
  }, []);

  const cancelRemove = useCallback(() => {
    if (removing) {
      return;
    }
    setRemoveTargetId(null);
  }, [removing]);

  const confirmRemove = useCallback(async () => {
    if (!removeTargetId) {
      return;
    }

    setRemoving(true);
    try {
      const ok = await remove(removeTargetId);
      if (ok) {
        setUnavailableIds((current) => {
          if (!current[removeTargetId]) {
            return current;
          }
          const next = { ...current };
          delete next[removeTargetId];
          return next;
        });
        setRemoveTargetId(null);
      }
    } finally {
      setRemoving(false);
    }
  }, [remove, removeTargetId]);

  const openDownloads = useCallback(() => {
    navigation.navigate(routePaths.downloads);
  }, []);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.back();
      return;
    }
    navigation.replace(routePaths.downloads);
  }, []);

  const dismissOpenError = useCallback(() => {
    setOpenError(null);
  }, []);

  return {
    orderedIds,
    itemsById,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    ready,
    initialized,
    load,
    refresh,
    loadMore,
    status,
    searchDraft,
    removeTargetId,
    removing,
    unavailableIds,
    openError,
    onChangeSearch,
    onSubmitSearch,
    openEntry,
    requestRemove,
    cancelRemove,
    confirmRemove,
    openDownloads,
    goBack,
    dismissOpenError,
  };
}

export type FavoritesScreenModel = ReturnType<typeof useFavoritesScreen>;
