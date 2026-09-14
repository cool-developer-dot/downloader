import type { LibraryFilter } from '@/library/types';
import type { DownloadSortOption, DownloadUiFilter } from '@/store/downloads';

/**
 * In-memory routing intent for Browser overflow shortcuts.
 *
 * This is not a data store: it carries destination + existing filter keys only.
 * Authoritative records stay in Downloads / Library / history / bookmarks stores.
 */
export type DownloadsDestinationIntent = {
  domain: 'downloads';
  statusFilter: DownloadUiFilter;
  sort?: DownloadSortOption;
};

export type LibraryDestinationIntent = {
  domain: 'library';
  filter: LibraryFilter;
  clearSearch: true;
};

export type SecondaryDestinationIntent =
  | DownloadsDestinationIntent
  | LibraryDestinationIntent;

export const SECONDARY_DESTINATIONS = {
  /** Existing Downloads Running filter → canonical DOWNLOADING. */
  activeDownloads: {
    domain: 'downloads',
    statusFilter: 'running',
  } satisfies DownloadsDestinationIntent,
  /** Existing Downloads Completed filter, newest first. */
  recentDownloads: {
    domain: 'downloads',
    statusFilter: 'completed',
    sort: 'newest',
  } satisfies DownloadsDestinationIntent,
  /** Library default filter — Continue Watching section is shown on `all`. */
  continueWatching: {
    domain: 'library',
    filter: 'all',
    clearSearch: true,
  } satisfies LibraryDestinationIntent,
  /** Existing Library Recently Watched filter. */
  recentlyWatched: {
    domain: 'library',
    filter: 'recently_watched',
    clearSearch: true,
  } satisfies LibraryDestinationIntent,
} as const;

let pendingIntent: SecondaryDestinationIntent | null = null;

export function requestSecondaryDestination(
  intent: SecondaryDestinationIntent,
): void {
  pendingIntent = intent;
}

export function consumeSecondaryDestinationIntent(): SecondaryDestinationIntent | null {
  const next = pendingIntent;
  pendingIntent = null;
  return next;
}

export function peekSecondaryDestinationIntentForTests(): SecondaryDestinationIntent | null {
  return pendingIntent;
}

export function clearSecondaryDestinationIntentForTests(): void {
  pendingIntent = null;
}
