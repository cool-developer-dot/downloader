import type { PaginationInput, SearchInput, SortInput } from './pagination.types';

export interface BrowserHistoryEntry {
  id: string;
  url: string;
  title: string;
  hostname: string;
  visitedAt: string;
  createdAt: string;
}

export interface CreateHistoryInput {
  id?: string | null;
  url: string;
  title?: string | null;
  hostname?: string | null;
  visitedAt?: string | null;
}

export interface UpdateHistoryInput {
  title?: string;
  url?: string;
  hostname?: string;
  visitedAt?: string;
}

export type HistorySortField = 'visitedAt' | 'createdAt' | 'title' | 'hostname';

export type ListHistoryOptions = PaginationInput &
  SearchInput &
  SortInput<HistorySortField>;
