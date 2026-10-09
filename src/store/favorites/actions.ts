import type { StoreApi } from 'zustand';

import {
  isApiError,
  type FavoriteItem,
  type FavoritePlatform,
} from '@/api';
import {
  downloadCatalogRepository,
  urlFavoriteRepository,
  urlFavoriteToApiItem,
} from '@/storage/repositories';
import { createId } from '@/storage/utils';

import { initialFavoritesState } from './state';
import type { FavoritesActions, FavoritesStore } from './types';

const FAVORITE_PLATFORMS: readonly FavoritePlatform[] = [
  'YOUTUBE',
  'FACEBOOK',
  'INSTAGRAM',
  'TIKTOK',
  'X',
  'VIMEO',
  'DAILYMOTION',
  'OTHER',
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
  if (isApiError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Align client matching with backend URL uniqueness (normalizeUrl semantics). */
export function normalizeFavoriteSourceKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return trimmed;
    }

    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();

    if (
      (parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = '';
    }

    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    // Match backend normalizeUrl — do not lowercase path/query.
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return trimmed;
  }
}

export function toFavoritePlatform(platform: string): FavoritePlatform {
  const upper = platform.trim().toUpperCase();

  if ((FAVORITE_PLATFORMS as readonly string[]).includes(upper)) {
    return upper as FavoritePlatform;
  }

  if (upper === 'TWITTER' || upper === 'TWITTER_X') {
    return 'X';
  }

  return 'OTHER';
}

export function resolveFavoriteThumbnailUrl(
  thumbnailUrl: string | null | undefined,
  sourceUrl: string,
): string {
  const trimmed = typeof thumbnailUrl === 'string' ? thumbnailUrl.trim() : '';

  if (trimmed && /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  try {
    return `${new URL(sourceUrl).origin}/favicon.ico`;
  } catch {
    return 'https://vidorax.app/favicon.ico';
  }
}

/** Defensive parse — one bad record must not crash the screen. */
export function normalizeFavoriteItem(raw: unknown): FavoriteItem | null {
  if (!isRecord(raw)) {
    return null;
  }

  const id = typeof raw.id === 'string' ? raw.id : null;
  const sourceUrl = typeof raw.sourceUrl === 'string' ? raw.sourceUrl : null;
  const platformRaw = typeof raw.platform === 'string' ? raw.platform : null;

  if (!id || !sourceUrl || !platformRaw) {
    return null;
  }

  const platform = toFavoritePlatform(platformRaw);
  const createdAt =
    typeof raw.createdAt === 'string'
      ? raw.createdAt
      : raw.createdAt instanceof Date
        ? raw.createdAt.toISOString()
        : new Date(0).toISOString();

  return {
    id,
    userId: typeof raw.userId === 'string' ? raw.userId : '',
    title: typeof raw.title === 'string' ? raw.title : '',
    platform,
    sourceUrl,
    thumbnailUrl:
      typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : '',
    createdAt,
  };
}

function buildIndex(items: FavoriteItem[]): {
  itemsById: Record<string, FavoriteItem>;
  orderedIds: string[];
  urlIndex: Record<string, string>;
} {
  const itemsById: Record<string, FavoriteItem> = {};
  const orderedIds: string[] = [];
  const urlIndex: Record<string, string> = {};

  for (const item of items) {
    if (itemsById[item.id]) {
      continue;
    }
    itemsById[item.id] = item;
    orderedIds.push(item.id);
    const key = normalizeFavoriteSourceKey(item.sourceUrl);
    if (key) {
      urlIndex[key] = item.id;
    }
  }

  return { itemsById, orderedIds, urlIndex };
}

function mergeAppend(
  existingIds: string[],
  existingById: Record<string, FavoriteItem>,
  existingUrlIndex: Record<string, string>,
  nextItems: FavoriteItem[],
): {
  itemsById: Record<string, FavoriteItem>;
  orderedIds: string[];
  urlIndex: Record<string, string>;
} {
  const itemsById = { ...existingById };
  const orderedIds = [...existingIds];
  const urlIndex = { ...existingUrlIndex };
  const seen = new Set(existingIds);

  for (const item of nextItems) {
    itemsById[item.id] = item;
    const key = normalizeFavoriteSourceKey(item.sourceUrl);
    if (key) {
      urlIndex[key] = item.id;
    }
    if (!seen.has(item.id)) {
      orderedIds.push(item.id);
      seen.add(item.id);
    }
  }

  return { itemsById, orderedIds, urlIndex };
}

export function createFavoritesActions(
  set: StoreApi<FavoritesStore>['setState'],
  get: StoreApi<FavoritesStore>['getState'],
): FavoritesActions {
  let loadRequestId = 0;
  let loadMoreInFlight = false;
  let ensureReadyInFlight: Promise<void> | null = null;

  return {
    setQuery: (query) => {
      set({ query });
    },
    setSort: (sort) => {
      const current = get().sort;
      if (current === sort) {
        return;
      }

      set({
        sort,
        page: 1,
        orderedIds: [],
        itemsById: {},
        urlIndex: {},
        ready: false,
        hasMore: false,
        total: 0,
        error: null,
      });
    },
    applyPage: (items, meta, append = false) => {
      const normalized = items
        .map(normalizeFavoriteItem)
        .filter((item): item is FavoriteItem => item !== null);

      set((state) => {
        const index = append
          ? mergeAppend(
              state.orderedIds,
              state.itemsById,
              state.urlIndex,
              normalized,
            )
          : buildIndex(normalized);

        return {
          ...index,
          total: meta.total,
          page: meta.page,
          pageSize: meta.pageSize,
          hasMore: meta.hasMore,
          ready: true,
          initialized: true,
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: null,
        };
      });
    },
    prependOrUpdate: (item) => {
      const normalized = normalizeFavoriteItem(item);
      if (!normalized) {
        return;
      }

      set((state) => {
        const existed = Boolean(state.itemsById[normalized.id]);
        const key = normalizeFavoriteSourceKey(normalized.sourceUrl);
        const previousIdForUrl = key ? state.urlIndex[key] : undefined;

        const itemsById = { ...state.itemsById, [normalized.id]: normalized };
        if (
          previousIdForUrl &&
          previousIdForUrl !== normalized.id &&
          itemsById[previousIdForUrl]
        ) {
          delete itemsById[previousIdForUrl];
        }

        const withoutDupes = state.orderedIds.filter(
          (id) => id !== normalized.id && id !== previousIdForUrl,
        );
        const orderedIds = [normalized.id, ...withoutDupes];
        const urlIndex = { ...state.urlIndex };
        if (key) {
          urlIndex[key] = normalized.id;
        }

        return {
          itemsById,
          orderedIds,
          urlIndex,
          total: existed ? state.total : state.total + 1,
          ready: true,
          initialized: true,
          error: null,
        };
      });
    },
    load: async (page = 1) => {
      const state = get();
      const requestId = ++loadRequestId;
      const isFirstPage = page === 1;
      // Known empty lists are still cache — avoid full-screen loading on revisit.
      const hasKnownState = state.initialized || state.orderedIds.length > 0;

      set({
        loading: isFirstPage && !hasKnownState,
        refreshing: isFirstPage && hasKnownState,
        loadingMore: !isFirstPage,
        error: null,
      });

      try {
        const response = await urlFavoriteRepository.list({
          page,
          limit: state.pageSize,
          search: state.query.trim() || undefined,
          sort: state.sort,
        });

        if (requestId !== loadRequestId) {
          return;
        }

        get().applyPage(
          response.items.map(urlFavoriteToApiItem),
          {
            total: response.total,
            page: response.page,
            pageSize: response.pageSize,
            hasMore: response.hasMore,
          },
          !isFirstPage,
        );
      } catch (error) {
        if (requestId !== loadRequestId) {
          return;
        }

        set({
          loading: false,
          loadingMore: false,
          refreshing: false,
          error: getErrorMessage(error, 'Failed to load favorites'),
          initialized: true,
        });
      }
    },
    refresh: async () => {
      await get().load(1);
    },
    loadMore: async () => {
      const state = get();

      if (!state.hasMore || state.loading || state.loadingMore || state.refreshing) {
        return;
      }

      if (loadMoreInFlight) {
        return;
      }

      loadMoreInFlight = true;

      try {
        await get().load(state.page + 1);
      } finally {
        loadMoreInFlight = false;
      }
    },
    search: async (query) => {
      set({ query, page: 1 });
      await get().load(1);
    },
    ensureReady: async () => {
      const state = get();
      if (state.initialized || state.loading) {
        return;
      }

      if (ensureReadyInFlight) {
        await ensureReadyInFlight;
        return;
      }

      ensureReadyInFlight = get()
        .load(1)
        .finally(() => {
          ensureReadyInFlight = null;
        });

      await ensureReadyInFlight;
    },
    add: async (input) => {
      set({ saving: true, error: null });

      try {
        const entry = await urlFavoriteRepository.upsert({
          title: input.title.trim() || input.sourceUrl,
          platform: toFavoritePlatform(input.platform),
          sourceUrl: input.sourceUrl.trim(),
          thumbnailUrl: resolveFavoriteThumbnailUrl(
            input.thumbnailUrl,
            input.sourceUrl,
          ),
        });
        const favorite = urlFavoriteToApiItem(entry);

        get().prependOrUpdate(favorite);
        set({ saving: false });

        return favorite;
      } catch (error) {
        set({
          saving: false,
          error: getErrorMessage(error, 'Failed to add favorite'),
        });
        return null;
      }
    },
    remove: async (id) => {
      set((state) => ({
        mutatingIds: { ...state.mutatingIds, [id]: true },
        error: null,
      }));

      try {
        const existing = get().itemsById[id];
        await urlFavoriteRepository.delete(id);

        set((state) => {
          const itemsById = { ...state.itemsById };
          delete itemsById[id];
          const mutatingIds = { ...state.mutatingIds };
          delete mutatingIds[id];
          const urlIndex = { ...state.urlIndex };

          if (existing) {
            const key = normalizeFavoriteSourceKey(existing.sourceUrl);
            if (key && urlIndex[key] === id) {
              delete urlIndex[key];
            }
          }

          return {
            itemsById,
            orderedIds: state.orderedIds.filter((itemId) => itemId !== id),
            total: Math.max(0, state.total - 1),
            mutatingIds,
            urlIndex,
          };
        });

        return true;
      } catch (error) {
        set((state) => {
          const mutatingIds = { ...state.mutatingIds };
          delete mutatingIds[id];
          return {
            mutatingIds,
            error: getErrorMessage(error, 'Failed to remove favorite'),
          };
        });
        return false;
      }
    },
    removeBySourceUrl: async (sourceUrl) => {
      const key = normalizeFavoriteSourceKey(sourceUrl);
      const id = get().urlIndex[key];

      if (id) {
        return get().remove(id);
      }

      const resolved = await get().resolveFavoriteForUrl(sourceUrl);
      if (!resolved) {
        return false;
      }

      return get().remove(resolved.id);
    },
    toggleOptimistic: async (input) => {
      const key = normalizeFavoriteSourceKey(input.sourceUrl);
      const state = get();

      if (!key) {
        return { favorited: false, favorite: null, error: 'A valid source URL is required' };
      }

      const desiredFavorited = !Boolean(state.urlIndex[key]);
      const mediaId = input.mediaId;

      if (!mediaId) {
        return { favorited: false, favorite: null, error: 'Missing media id' };
      }

      const nextSeq = (state.mutationSeqByKey[key] ?? 0) + 1;

      // De-dupe rapid taps that don't change desired state.
      if (
        state.pendingUrls[key] &&
        state.inFlightDesiredByKey[key] === desiredFavorited
      ) {
        const existingId = state.urlIndex[key];
        return {
          favorited: desiredFavorited,
          favorite: existingId ? state.itemsById[existingId] ?? null : null,
        };
      }

      const previousFavoriteId = state.urlIndex[key] ?? null;
      const previousFavoriteItem = previousFavoriteId
        ? state.itemsById[previousFavoriteId] ?? null
        : null;

      const optimisticFavoriteId = desiredFavorited
        ? `optimistic-${mediaId}-${nextSeq}`
        : null;

      set((s) => ({
        pendingUrls: { ...s.pendingUrls, [key]: true },
        mutationSeqByKey: { ...s.mutationSeqByKey, [key]: nextSeq },
        inFlightDesiredByKey: {
          ...s.inFlightDesiredByKey,
          [key]: desiredFavorited,
        },
        saving: true,
        error: null,
      }));

      // Apply optimistic state change immediately.
      if (desiredFavorited) {
        const optimistic: FavoriteItem = {
          id: optimisticFavoriteId as string,
          userId: '',
          title: input.title.trim() || input.sourceUrl,
          platform: toFavoritePlatform(input.platform),
          sourceUrl: input.sourceUrl.trim(),
          thumbnailUrl: resolveFavoriteThumbnailUrl(
            input.thumbnailUrl,
            input.sourceUrl,
          ),
          createdAt: new Date().toISOString(),
        };
        get().prependOrUpdate(optimistic);
      } else if (previousFavoriteId) {
        set((current) => {
          const itemsById = { ...current.itemsById };
          delete itemsById[previousFavoriteId];
          const urlIndex = { ...current.urlIndex };
          delete urlIndex[key];
          const orderedIds = current.orderedIds.filter((id) => id !== previousFavoriteId);
          return {
            itemsById,
            orderedIds,
            total: orderedIds.length,
            urlIndex,
          };
        });
      }

      try {
        await downloadCatalogRepository.setFavorite(mediaId, desiredFavorited);
        const { refreshFavoriteMediaIdCache } = await import(
          '@/storage/services/catalog-persist'
        );
        await refreshFavoriteMediaIdCache();

        if (desiredFavorited) {
          const stableId = previousFavoriteId?.startsWith('optimistic-')
            ? await createId()
            : previousFavoriteId ?? (await createId());
          const entry = await urlFavoriteRepository.upsert({
            id: stableId,
            title: input.title.trim() || input.sourceUrl,
            platform: toFavoritePlatform(input.platform),
            sourceUrl: input.sourceUrl.trim(),
            thumbnailUrl: resolveFavoriteThumbnailUrl(
              input.thumbnailUrl,
              input.sourceUrl,
            ),
          });
          get().prependOrUpdate(urlFavoriteToApiItem(entry));
          if (optimisticFavoriteId && optimisticFavoriteId !== entry.id) {
            set((current) => {
              const itemsById = { ...current.itemsById };
              delete itemsById[optimisticFavoriteId];
              const orderedIds = current.orderedIds.filter(
                (id) => id !== optimisticFavoriteId,
              );
              if (!orderedIds.includes(entry.id)) {
                orderedIds.unshift(entry.id);
              }
              return {
                itemsById: { ...itemsById, [entry.id]: urlFavoriteToApiItem(entry) },
                orderedIds,
                total: orderedIds.length,
                urlIndex: {
                  ...current.urlIndex,
                  [key]: entry.id,
                },
              };
            });
          }
        } else {
          await urlFavoriteRepository.deleteBySourceUrl(input.sourceUrl);
        }

        const currentSeq = get().mutationSeqByKey[key];
        if (currentSeq !== nextSeq) {
          return {
            favorited: desiredFavorited,
            favorite: desiredFavorited
              ? (() => {
                  const fid = get().urlIndex[key];
                  return fid ? get().itemsById[fid] ?? null : null;
                })()
              : null,
          };
        }

        set((current) => {
          const pendingUrls = { ...current.pendingUrls };
          delete pendingUrls[key];
          const inFlightDesiredByKey = { ...current.inFlightDesiredByKey };
          delete inFlightDesiredByKey[key];

          const saving = Object.values(pendingUrls).some(Boolean);

          return { pendingUrls, inFlightDesiredByKey, saving, error: null };
        });

        const finalFavoriteId = get().urlIndex[key];
        return {
          favorited: desiredFavorited,
          favorite: finalFavoriteId ? get().itemsById[finalFavoriteId] ?? null : null,
        };
      } catch (error) {
        const currentSeq = get().mutationSeqByKey[key];
        if (currentSeq !== nextSeq) {
          return {
            favorited: Boolean(previousFavoriteId),
            favorite: previousFavoriteItem,
          };
        }

        // Rollback to the previous favorite state for this key.
        set((current) => {
          const itemsById = { ...current.itemsById };
          const urlIndex = { ...current.urlIndex };
          let orderedIds = [...current.orderedIds];

          if (previousFavoriteId && previousFavoriteItem) {
            itemsById[previousFavoriteId] = previousFavoriteItem;
            urlIndex[key] = previousFavoriteId;
            orderedIds = orderedIds.filter((id) => id !== previousFavoriteId);
            orderedIds = [previousFavoriteId, ...orderedIds];
          } else {
            if (optimisticFavoriteId) {
              delete itemsById[optimisticFavoriteId];
              orderedIds = orderedIds.filter((id) => id !== optimisticFavoriteId);
            }
            delete urlIndex[key];
          }

          return {
            itemsById,
            orderedIds,
            urlIndex,
            total: orderedIds.length,
            pendingUrls: (() => {
              const pending = { ...current.pendingUrls };
              delete pending[key];
              return pending;
            })(),
            inFlightDesiredByKey: (() => {
              const inflight = { ...current.inFlightDesiredByKey };
              delete inflight[key];
              return inflight;
            })(),
            saving: false,
            error: getErrorMessage(error, 'Failed to update favorite'),
          };
        });

        return {
          favorited: Boolean(previousFavoriteId),
          favorite: previousFavoriteItem,
          error: getErrorMessage(error, 'Failed to update favorite'),
        };
      }
    },
    resolveFavoriteForUrl: async (sourceUrl) => {
      const key = normalizeFavoriteSourceKey(sourceUrl);
      if (!key) {
        return null;
      }

      const state = get();
      const cachedId = state.urlIndex[key];
      if (cachedId && state.itemsById[cachedId]) {
        return state.itemsById[cachedId];
      }

      try {
        const entry = await urlFavoriteRepository.getBySourceUrl(sourceUrl);
        if (!entry) {
          return null;
        }
        const match = urlFavoriteToApiItem(entry);
        get().prependOrUpdate(match);
        return match;
      } catch {
        return null;
      }
    },
    isUrlFavorited: (sourceUrl) => {
      const key = normalizeFavoriteSourceKey(sourceUrl);
      return Boolean(key && get().urlIndex[key]);
    },
    reset: () => {
      loadRequestId += 1;
      loadMoreInFlight = false;
      ensureReadyInFlight = null;
      set(initialFavoritesState);
    },
  };
}
