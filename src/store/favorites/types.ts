import type {
  FavoriteItem,
  FavoriteListSort,
  FavoritePlatform,
} from '@/api';

export type { FavoriteItem, FavoriteListSort, FavoritePlatform };

export type FavoriteSortOption = 'newest' | 'oldest';

export interface CreateFavoriteInput {
  title: string;
  platform: string;
  sourceUrl: string;
  thumbnailUrl?: string | null;
}

export interface FavoritesState {
  itemsById: Record<string, FavoriteItem>;
  orderedIds: string[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  sort: FavoriteSortOption;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  saving: boolean;
  /** sourceUrl key → favorite id */
  urlIndex: Record<string, string>;
  /** sourceUrl keys currently being toggled */
  pendingUrls: Record<string, boolean>;
  /** Per sourceUrl key optimistic mutation sequence (prevents stale rollback). */
  mutationSeqByKey: Record<string, number>;
  /** In-flight desired state for de-duping same-tap duplicates. */
  inFlightDesiredByKey: Record<string, boolean>;
  mutatingIds: Record<string, boolean>;
  error: string | null;
  ready: boolean;
  initialized: boolean;
}

export interface FavoritesActions {
  setQuery: (query: string) => void;
  setSort: (sort: FavoriteSortOption) => void;
  applyPage: (
    items: FavoriteItem[],
    meta: {
      total: number;
      page: number;
      pageSize: number;
      hasMore: boolean;
    },
    append?: boolean,
  ) => void;
  prependOrUpdate: (item: FavoriteItem) => void;
  load: (page?: number) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  ensureReady: () => Promise<void>;
  add: (input: CreateFavoriteInput) => Promise<FavoriteItem | null>;
  remove: (id: string) => Promise<boolean>;
  removeBySourceUrl: (sourceUrl: string) => Promise<boolean>;
  toggleOptimistic: (
    input: CreateFavoriteInput & { mediaId: string },
  ) => Promise<{
    favorited: boolean;
    favorite: FavoriteItem | null;
    error?: string;
  }>;
  resolveFavoriteForUrl: (sourceUrl: string) => Promise<FavoriteItem | null>;
  isUrlFavorited: (sourceUrl: string) => boolean;
  reset: () => void;
}

export type FavoritesStore = FavoritesState & FavoritesActions;
