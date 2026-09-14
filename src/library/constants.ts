import type { LibraryFilter, LibrarySort, LibraryViewMode } from './types';

/**
 * Recently Downloaded filter window.
 * Based solely on durable `downloadedAt` — not watch recency.
 */
export const LIBRARY_RECENT_DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Bound filesystem reconciliation so list render never stats on every frame. */
export const LIBRARY_RECONCILE_TTL_MS = 30_000;

/** Debounce in-memory search so keypresses never rescan FS or hit the network. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 200;

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'newest';
export const DEFAULT_LIBRARY_FILTER: LibraryFilter = 'all';
export const DEFAULT_LIBRARY_VIEW_MODE: LibraryViewMode = 'list';

export const LIBRARY_VIEW_MODE_VERSION = 1;

export const TEMP_FILE_MARKERS = [
  '.part',
  '.rangepart',
  '/.hls/',
  '\\.hls\\',
  '/.mranges/',
  '\\.mranges\\',
  'assemble.tmp',
  'merge.tmp',
] as const;

export const HLS_WORKSPACE_FOLDER = '.hls';
export const MULTI_RANGE_WORKSPACE_FOLDER = '.mranges';

/** UI-only selection id for “Downloads / Unfiled”. Local catalog only. */
export const UNFILED_FOLDER_SELECTION_ID = 'unfiled';
