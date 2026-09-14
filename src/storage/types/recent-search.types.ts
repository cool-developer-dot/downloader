import type { PaginationInput, SearchInput, SortInput } from './pagination.types';

export interface RecentSearchEntry {
  id: string;
  query: string;
  searchedAt: string;
  createdAt: string;
}

export interface CreateRecentSearchInput {
  query: string;
  searchedAt?: string | null;
}

export type RecentSearchSortField = 'searchedAt' | 'createdAt' | 'query';

export type ListRecentSearchesOptions = PaginationInput &
  SearchInput &
  SortInput<RecentSearchSortField>;

export interface RecentUrlEntry {
  id: string;
  url: string;
  title: string;
  hostname: string;
  accessedAt: string;
  createdAt: string;
}

export interface UpsertRecentUrlInput {
  url: string;
  title?: string | null;
  hostname?: string | null;
  accessedAt?: string | null;
}
