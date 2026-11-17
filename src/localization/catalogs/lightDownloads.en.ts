/** Light theme (CEO design) — `lightDownloads` screen strings. Keys are added by the screen that uses them. */
export const lightDownloadsEn = {
  /** Header subtitle while something downloads: "3 active · 14.2 MB/s". */
  activeSummary: '{count} active · {speed}',
  /** Header subtitle while something downloads but no speed is known yet. */
  activeCount: '{count} active',
  chipActive: 'Active',
  totalSpeed: 'Total speed',
  speedGraphA11y: 'Total download speed over the last {seconds} seconds, peak {max}',
  statusDownloading: 'Downloading',
  /** "62% · Downloading" under a card's progress bar. */
  progressStatus: '{percent}% · {status}',
  eta: 'ETA {time}',
  completedActionsA11y: 'Actions for the finished file',
  addLink: 'Add link',
  addLinkHint: 'Opens Add download. Touch and hold for the queue, batch add and history',
  moreTitle: 'Downloads',
  batchAdd: 'Batch add',
  downloadHistory: 'Download history',
  clearSearch: 'Clear search',
  showSearch: 'Show search',
  hideSearch: 'Hide search',
  sortA11y: 'Sort downloads',
  resetControls: 'Reset search, filter and sort',
  itemMenuTitle: 'Download',
  itemMenuA11y: 'More actions for this download',
  openDetails: 'Details',
  loadFailed: 'Couldn’t load downloads',
  retryLoad: 'Try again',
} as const;
