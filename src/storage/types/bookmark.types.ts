import type { PaginationInput, SearchInput, SortInput } from './pagination.types';

export interface BookmarkEntry {
  id: string;
  url: string;
  title: string;
  hostname: string;
  faviconUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookmarkInput {
  id?: string | null;
  url: string;
  title?: string | null;
  hostname?: string | null;
  faviconUrl?: string | null;
}

export interface UpdateBookmarkInput {
  title?: string;
  url?: string;
  hostname?: string;
  faviconUrl?: string | null;
}

export type BookmarkSortField = 'createdAt' | 'updatedAt' | 'title' | 'hostname';

export type ListBookmarksOptions = PaginationInput &
  SearchInput &
  SortInput<BookmarkSortField>;
