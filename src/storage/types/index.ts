export type {
  BrowserHistoryEntry,
  CreateHistoryInput,
  HistorySortField,
  ListHistoryOptions,
  UpdateHistoryInput,
} from './history.types';
export type {
  BookmarkEntry,
  CreateBookmarkInput,
  BookmarkSortField,
  ListBookmarksOptions,
  UpdateBookmarkInput,
} from './bookmark.types';
export type {
  CreateRecentSearchInput,
  ListRecentSearchesOptions,
  RecentSearchEntry,
  RecentSearchSortField,
  RecentUrlEntry,
  UpsertRecentUrlInput,
} from './recent-search.types';
export type {
  CreateUrlFavoriteInput,
  DownloadCatalogEntry,
  ListDownloadCatalogOptions,
  MediaFolderEntry,
  UpsertDownloadCatalogInput,
  UrlFavoriteEntry,
} from './catalog.types';
export {
  buildPaginatedResult,
  normalizePagination,
  type PaginatedResult,
  type PaginationInput,
  type SearchInput,
  type SortDirection,
  type SortInput,
} from './pagination.types';
export {
  StorageError,
  isStorageError,
  toStorageError,
  type StorageErrorCode,
} from './errors';
