export {
  useAppStore,
  selectAppFirstLaunch,
  selectAppInitialized,
  selectAppLoading,
  selectAppMaintenanceMode,
  selectAppOnline,
  selectAppVersion,
  selectOnboardingComplete,
} from './app';
export type { AppActions, AppState, AppStore } from './app';

export {
  useBrowserStore,
  selectAddressBarState,
  selectBrowserError,
  selectCanGoBack,
  selectCanGoForward,
  selectCurrentUrl,
  selectIsHome,
  selectIsLoading,
  selectIsSecure,
  selectLastVisited,
  selectNavigationChrome,
  selectPageTitle,
  selectProgress,
  selectSecurityLevel,
} from './browser';
export type { BrowserActions, BrowserErrorState, BrowserSecurityLevel, BrowserState, BrowserStore } from './browser';

export {
  useBookmarksStore,
  selectBookmarkItems,
  selectBookmarksError,
  selectBookmarksHasMore,
  selectBookmarksInitialized,
  selectBookmarksLoading,
  selectBookmarksLoadingMore,
  selectBookmarksPendingUrls,
  selectBookmarksQuery,
  selectBookmarksReady,
  selectBookmarksRefreshing,
  selectBookmarksSaving,
  selectBookmarksSyncing,
  selectBookmarksTotal,
  selectBookmarksUrlIndex,
} from './bookmarks';
export type { BookmarksActions, BookmarksState, BookmarksStore } from './bookmarks';

export {
  useDownloadsStore,
  selectActiveDownloads,
  selectCompletedDownloads,
  selectDownloadQueue,
  selectPausedDownloads,
  selectFailedDownloads,
  deriveDownloadActivitySummary,
  selectDownloadActivitySummary,
  selectDownloadActivitySignature,
  selectCompletedCatalogSignature,
  selectManagedStorageBytesSignature,
  selectDownloadOrderedIds,
  selectDownloadItemsById,
  selectDownloadsTotal,
  selectDownloadsLoading,
  selectDownloadsLoadingMore,
  selectDownloadsRefreshing,
  selectDownloadsError,
  selectDownloadsHasMore,
  selectDownloadsQuery,
  selectDownloadsStatusFilter,
  selectDownloadsSort,
  selectDownloadsReady,
  selectDownloadsInitialized,
  selectDownloadsMutatingIds,
  selectDownloadTransferById,
  selectDownloadTransfer,
  selectDownloadById,
  selectIsDownloadMutating,
  uiFilterToApiStatus,
  normalizeDownloadItem,
} from './downloads';
export type {
  DownloadItem,
  DownloadListSort,
  DownloadSortOption,
  DownloadStatus,
  DownloadUiFilter,
  DownloadActivitySummary,
  DownloadsActions,
  DownloadsState,
  DownloadsStore,
} from './downloads';

export {
  useFavoritesStore,
  selectFavoriteOrderedIds,
  selectFavoriteItemsById,
  selectFavoritesTotal,
  selectFavoritesLoading,
  selectFavoritesLoadingMore,
  selectFavoritesRefreshing,
  selectFavoritesSaving,
  selectFavoritesError,
  selectFavoritesHasMore,
  selectFavoritesQuery,
  selectFavoritesSort,
  selectFavoritesReady,
  selectFavoritesInitialized,
  selectFavoritesUrlIndex,
  selectFavoritesPendingUrls,
  selectFavoritesMutatingIds,
  selectFavoriteById,
  selectIsFavoriteMutating,
  normalizeFavoriteItem,
  normalizeFavoriteSourceKey,
  resolveFavoriteThumbnailUrl,
  toFavoritePlatform,
} from './favorites';
export type {
  CreateFavoriteInput,
  FavoriteItem,
  FavoriteListSort,
  FavoritePlatform,
  FavoriteSortOption,
  FavoritesActions,
  FavoritesState,
  FavoritesStore,
} from './favorites';

export {
  useHistoryStore,
  selectHistoryError,
  selectHistoryHasMore,
  selectHistoryInitialized,
  selectHistoryItems,
  selectHistoryLastSync,
  selectHistoryLoading,
  selectHistoryLoadingMore,
  selectHistoryQuery,
  selectHistoryReady,
  selectHistoryRefreshing,
  selectHistorySyncing,
  selectHistoryTotal,
} from './history';
export type { HistoryActions, HistoryState, HistoryStore } from './history';

export {
  useLibraryStore,
  selectLibrarySearchQuery,
  selectLibraryFilter,
  selectLibrarySort,
  selectLibraryQuality,
  selectLibraryFolderId,
  selectLibraryViewMode,
  selectLibraryAvailabilityById,
  selectLibraryLoading,
  selectLibraryRefreshing,
  selectLibraryError,
  selectLibraryInitialized,
  selectLibraryLastReconciledAt,
} from './library';
export type {
  LibraryActions,
  LibraryFilter,
  LibrarySort,
  LibraryState,
  LibraryStore,
  LibraryViewMode,
  LocalAvailability,
} from './library';

export { usePlayerStore, selectCurrentVideo, selectFullscreen, selectPlaybackPosition, selectPlaybackRate } from './player';
export type { PlayerActions, PlayerState, PlayerStore, VideoItem } from './player';

export {
  useRecentSearchesStore,
  selectRecentSearchItems,
  selectRecentSearchesError,
  selectRecentSearchesHasMore,
  selectRecentSearchesLoading,
  selectRecentSearchesQuery,
  selectRecentSearchesTotal,
} from './recent-searches';
export type {
  RecentSearchesActions,
  RecentSearchesState,
  RecentSearchesStore,
} from './recent-searches';

export {
  useSettingsStore,
  selectAutoResume,
  selectDownloadDirectory,
  selectLanguage,
  selectNotifications,
  selectWifiOnly,
} from './settings';
export type { SettingsActions, SettingsKey, SettingsState, SettingsStore } from './settings';

export { useThemeStore, selectThemeMode } from './theme';
export type { ThemeActions, ThemePreference, ThemeState, ThemeStore } from './theme';

export { configurePersistStorage, createPersistStorage, getPersistStorageAdapter } from './shared/persist-storage';
