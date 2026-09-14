export { HistoryService, historyService } from './history.service';
export { BookmarkService, bookmarkService } from './bookmark.service';
export { RecentSearchService, recentSearchService } from './recent-search.service';
export { ensureDownloadCatalogSeeded } from './catalog-seed.service';
export type { CatalogSeedResult } from './catalog-seed.service';
export {
  persistDownloadCatalogItem,
  persistDownloadCatalogPatch,
  removeDownloadCatalogItem,
  getCachedFavoriteMediaIds,
  refreshFavoriteMediaIdCache,
} from './catalog-persist';
