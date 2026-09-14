import type { LibraryFilter, LibrarySort } from '@/library';

export const LIBRARY_COPY = {
  title: 'Library',
  searchPlaceholder: 'Search downloaded videos',
  emptyTitle: 'No downloads yet',
  emptyDescription:
    'Completed downloads that are available on this device will appear here.',
  emptyAction: 'Go to Downloads',
  emptySearchTitle: 'No videos found',
  emptySearchDescription: 'Try a different title, file name, quality, or folder name.',
  emptyFilterTitle: 'No videos found',
  emptyFilterDescription: 'Try All, or choose a different filter.',
  emptyFavoritesTitle: 'No favorites yet',
  emptyFavoritesDescription: 'Mark videos as favorites to find them here.',
  emptyFolderTitle: 'This folder is empty',
  emptyFolderDescription: 'Move videos into this folder from download details.',
  errorTitle: 'Couldn’t load your library',
  errorRetry: 'Try again',
  offlineHint: 'Showing downloads saved on this device.',
  filterTitle: 'Filter',
  filterSubtitle: 'Show videos by category',
  sortTitle: 'Sort',
  sortSubtitle: 'Order your library',
  qualityTitle: 'Quality',
  qualitySubtitle: 'Show videos at a specific quality',
  resetControls: 'Reset',
  viewList: 'List view',
  viewGrid: 'Grid view',
  loadingAnnouncement: 'Loading library',
  emptyRecentlyWatchedTitle: 'No Recently Watched videos',
  emptyRecentlyWatchedDescription:
    'Videos you play will appear here, ordered by last watched.',
  continueWatchingTitle: 'Continue Watching',
  continueWatchingEmpty: 'No videos to continue',
  continueWatchingEmptyDescription:
    'Unfinished videos you start watching will show up here.',
  watchedBadge: 'Watched',
  watchHistoryTitle: 'Watch History',
} as const;

export const LIBRARY_FILTER_OPTIONS: readonly {
  id: LibraryFilter;
  label: string;
  available: boolean;
}[] = [
  { id: 'all', label: 'All', available: true },
  { id: 'favorites', label: 'Favorites', available: true },
  { id: 'recently_downloaded', label: 'Recently Downloaded', available: true },
  { id: 'recently_watched', label: 'Recently Watched', available: true },
  { id: 'folder', label: 'Folder', available: true },
] as const;

export const LIBRARY_SORT_OPTIONS: readonly {
  id: LibrarySort;
  label: string;
  available: boolean;
}[] = [
  { id: 'newest', label: 'Newest', available: true },
  { id: 'oldest', label: 'Oldest', available: true },
  { id: 'name_asc', label: 'Name A–Z', available: true },
  { id: 'name_desc', label: 'Name Z–A', available: true },
  { id: 'largest', label: 'Largest', available: true },
  { id: 'smallest', label: 'Smallest', available: true },
  { id: 'recently_played', label: 'Recently Played', available: true },
] as const;
