/**
 * Canonical media library entity.
 *
 * Identity is the download id — file name, folder, and rename must never
 * become identity. Presentation items never include device paths.
 */

export const LOCAL_AVAILABILITY = ['available', 'missing', 'unverified'] as const;

export type LocalAvailability = (typeof LOCAL_AVAILABILITY)[number];

export const LIBRARY_SORTS = [
  'newest',
  'oldest',
  'name_asc',
  'name_desc',
  'largest',
  'smallest',
  'recently_played',
] as const;

export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const LIBRARY_FILTERS = [
  'all',
  'favorites',
  'recently_downloaded',
  'recently_watched',
  'quality',
  'folder',
] as const;

export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

export const LIBRARY_VIEW_MODES = ['list', 'grid'] as const;

export type LibraryViewMode = (typeof LIBRARY_VIEW_MODES)[number];

/**
 * Presentation-safe library item.
 * Device URIs, cookies, source auth, and worker internals are never included.
 */
export interface MediaLibraryItem {
  id: string;
  downloadId: string;
  displayName: string;
  fileName: string;
  mimeType: string | null;
  /** Decimal byte string — never lexicographic identity. */
  fileSize: string;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  duration: number | null;
  downloadedAt: string | null;
  favorite: boolean;
  folderId: string | null;
  folderName: string | null;
  localAvailability: LocalAvailability;
  thumbnailUri: string | null;
  /**
   * Playback-history fields (Day 3 Phase 2).
   * Null/false when never played — never fabricated.
   */
  lastPlayedAt: string | null;
  progressPercent: number | null;
  positionSeconds: number | null;
  completed: boolean;
}

/** Optional catalog enrichment shape (local assemble may leave fields empty). */
export interface MediaLibraryRemoteItem {
  id: string;
  downloadId: string;
  displayName: string;
  fileName: string;
  mimeType: string | null;
  fileSize: string;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  duration: number | null;
  downloadedAt: string | null;
  favorite: boolean;
  folderId: string | null;
  folderName: string | null;
  thumbnailUrl: string | null;
}

export interface LibraryQueryInput {
  search: string;
  filter: LibraryFilter;
  sort: LibrarySort;
  quality: string | null;
  folderId: string | null;
  /**
   * Inclusive recent-download window in ms, measured from `now`.
   * Used only by the Recently Downloaded filter.
   */
  recentDownloadWindowMs: number;
  nowMs: number;
}

export interface LibraryBuildSource {
  downloadId: string;
  status: string | null;
  title: string | null;
  fileName: string | null;
  fileSize: string | null;
  quality: string | null;
  resolution: string | null;
  bitrate: number | null;
  duration: number | null;
  mimeType: string | null;
  downloadedAt: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  folderId: string | null;
  folderName: string | null;
  lastPlayedAt: string | null;
  progressPercent?: number | null;
  positionSeconds?: number | null;
  completed?: boolean;
  localUri: string | null;
  localState: string | null;
  favorite: boolean;
  localAvailability: LocalAvailability;
  verifiedBytes: number | null;
}

export type LibraryQueryResult = {
  items: MediaLibraryItem[];
  /** Items that passed eligibility + availability before product filters. */
  playableCount: number;
  sourceCount: number;
};
