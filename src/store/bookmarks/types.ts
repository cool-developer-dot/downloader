import type {
  BookmarkEntry,
  BookmarkSortField,
  PaginatedResult,
  SortDirection,
} from '@/storage/types';

export interface BookmarksState {
  items: BookmarkEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  sortBy: BookmarkSortField;
  sortDirection: SortDirection;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  syncing: boolean;
  saving: boolean;
  error: string | null;
  ready: boolean;
  initialized: boolean;
  lastSync: string | null;
  /** url -> bookmark id for O(1) page bookmark checks */
  urlIndex: Record<string, string>;
  /** urls currently being toggled (optimistic lock) */
  pendingUrls: Record<string, boolean>;
}

export interface BookmarksActions {
  setQuery: (query: string) => void;
  setSort: (sortBy: BookmarkSortField, sortDirection?: SortDirection) => void;
  load: (page?: number, options?: { forceRemote?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  add: (input: {
    url: string;
    title?: string | null;
    hostname?: string | null;
    faviconUrl?: string | null;
  }) => Promise<BookmarkEntry | null>;
  update: (
    id: string,
    input: {
      title?: string;
      url?: string;
      hostname?: string;
      faviconUrl?: string | null;
    },
  ) => Promise<BookmarkEntry | null>;
  remove: (id: string) => Promise<boolean>;
  removeByUrl: (url: string) => Promise<boolean>;
  toggle: (input: {
    url: string;
    title?: string | null;
    hostname?: string | null;
    faviconUrl?: string | null;
  }) => Promise<{ bookmarked: boolean; bookmark: BookmarkEntry | null }>;
  /**
   * Optimistic toggle used by browser chrome.
   * Instantly updates UI, persists, then rolls back on failure.
   */
  toggleOptimistic: (input: {
    url: string;
    title?: string | null;
    hostname?: string | null;
    faviconUrl?: string | null;
  }) => Promise<{ bookmarked: boolean; bookmark: BookmarkEntry | null; error?: string }>;
  clear: () => Promise<boolean>;
  applyPage: (result: PaginatedResult<BookmarkEntry>, append?: boolean) => void;
  prependOrUpdate: (entry: BookmarkEntry) => void;
  resolveBookmarkForUrl: (url: string) => Promise<BookmarkEntry | null>;
  isUrlBookmarked: (url: string) => boolean;
  reset: () => void;
}

export type BookmarksStore = BookmarksState & BookmarksActions;
