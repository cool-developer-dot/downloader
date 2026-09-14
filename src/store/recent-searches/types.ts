import type {
  PaginatedResult,
  RecentSearchEntry,
  RecentSearchSortField,
  SortDirection,
} from '@/storage/types';

export interface RecentSearchesState {
  items: RecentSearchEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  sortBy: RecentSearchSortField;
  sortDirection: SortDirection;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  ready: boolean;
}

export interface RecentSearchesActions {
  setQuery: (query: string) => void;
  setSort: (sortBy: RecentSearchSortField, sortDirection?: SortDirection) => void;
  load: (page?: number) => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  search: (query: string) => Promise<void>;
  record: (query: string) => Promise<RecentSearchEntry | null>;
  remove: (id: string) => Promise<boolean>;
  clear: () => Promise<boolean>;
  applyPage: (result: PaginatedResult<RecentSearchEntry>, append?: boolean) => void;
  reset: () => void;
}

export type RecentSearchesStore = RecentSearchesState & RecentSearchesActions;
