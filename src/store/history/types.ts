import type {
  BrowserHistoryEntry,
  HistorySortField,
  PaginatedResult,
  SortDirection,
} from '@/storage/types';

export interface HistoryState {
  items: BrowserHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  sortBy: HistorySortField;
  sortDirection: SortDirection;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  syncing: boolean;
  error: string | null;
  ready: boolean;
  initialized: boolean;
  lastSync: string | null;
}

export interface HistoryActions {
  setQuery: (query: string) => void;
  setSort: (sortBy: HistorySortField, sortDirection?: SortDirection) => void;
  load: (page?: number, options?: { forceRemote?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  addVisit: (input: {
    url: string;
    title?: string | null;
    hostname?: string | null;
    visitedAt?: string | null;
  }) => Promise<BrowserHistoryEntry | null>;
  remove: (id: string) => Promise<boolean>;
  clear: () => Promise<boolean>;
  applyPage: (result: PaginatedResult<BrowserHistoryEntry>, append?: boolean) => void;
  prependOrUpdate: (entry: BrowserHistoryEntry) => void;
  reset: () => void;
}

export type HistoryStore = HistoryState & HistoryActions;
