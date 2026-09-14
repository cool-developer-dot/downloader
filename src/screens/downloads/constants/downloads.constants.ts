import type { DownloadStatus, DownloadUiFilter } from '@/store/downloads';

export const DOWNLOADS_COPY = {
  title: 'Downloads',
  detailsTitle: 'Download Details',
  searchPlaceholder: 'Search downloads...',
  emptyTitle: 'No downloads yet',
  emptyDescription:
    'Open a video in Browser. VidoraX finds downloadable video automatically.',
  emptyAction: 'Open Browser',
  emptySearchTitle: 'No downloads found',
  emptySearchDescription: 'Try a different title, file name, or URL.',
  emptyFilterTitle: 'Nothing here',
  emptyFilterDescription: 'No downloads match this filter.',
  emptyCompletedTitle: 'No completed downloads',
  emptyCompletedDescription: 'Finished downloads will appear in this list.',
  errorTitle: 'Couldn’t load downloads',
  detailsErrorTitle: 'Couldn’t load download',
  detailsMissingTitle: 'Download unavailable',
  detailsMissingDescription: 'This download may have been removed.',
  detailsMissingAction: 'Back to Downloads',
  detailsInfoTitle: 'Download information',
  detailsSourceTitle: 'Source',
  detailsFavoriteHint: 'Add or remove this download from Favorites',
  detailsFavoriteLabel: 'Favorite',
  detailsFavoriteAddLabel: 'Add to favorites',
  detailsFavoriteRemoveLabel: 'Remove from favorites',
  detailsFavoriteErrorTitle: 'Couldn’t update favorite',
  detailsOpenFile: 'Open',
  detailsShareFile: 'Share',
  detailsFileUnavailable: 'File is not available on this device.',
  deleteTitle: 'Remove download?',
  deleteMessage:
    'This removes the download from this device and deletes its files.',
  deleteConfirm: 'Remove',
  deleteCancel: 'Cancel',
  filterTitle: 'Filter',
  filterSubtitle: 'Show downloads by status',
  sortTitle: 'Sort',
  sortSubtitle: 'Order by date added',
  loadingAnnouncement: 'Loading downloads',
  endOfList: 'You’re all caught up',
  resetControls: 'Reset',
  primaryPause: 'Pause download',
  primaryResume: 'Resume download',
  primaryCancel: 'Cancel download',
  primaryRetry: 'Retry download',
  primaryOpen: 'Open downloaded file',
  primaryShare: 'Share downloaded file',
  primaryRemove: 'Delete download',
  secondaryCancel: 'Cancel download',
  successToast: 'Added to Downloads',
} as const;

export const DOWNLOAD_FILTER_OPTIONS: readonly {
  id: DownloadUiFilter;
  label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'queued', label: 'Queued' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
] as const;

export const DOWNLOAD_SORT_OPTIONS = [
  { id: 'newest' as const, label: 'Newest' },
  { id: 'oldest' as const, label: 'Oldest' },
] as const;

export const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  QUEUED: 'Queued',
  DOWNLOADING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const DOWNLOAD_SECTION_ORDER: readonly {
  key: DownloadStatus;
  title: string;
}[] = [
  { key: 'DOWNLOADING', title: 'Running' },
  { key: 'QUEUED', title: 'Queued' },
  { key: 'PAUSED', title: 'Paused' },
  { key: 'COMPLETED', title: 'Completed' },
  { key: 'FAILED', title: 'Failed' },
  { key: 'CANCELLED', title: 'Cancelled' },
] as const;

export const SEARCH_DEBOUNCE_MS = 280;
