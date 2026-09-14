import { LIBRARY_RECENT_DOWNLOAD_WINDOW_MS, UNFILED_FOLDER_SELECTION_ID } from './constants';
import { isPlayableAvailability } from './eligibility';
import { normalizeWhitespace, parseByteSize } from './mapper';
import type {
  LibraryFilter,
  LibraryQueryInput,
  LibraryQueryResult,
  LibrarySort,
  MediaLibraryItem,
} from './types';

export function normalizeSearchQuery(raw: string): string {
  return normalizeWhitespace(raw).toLowerCase();
}

function haystack(item: MediaLibraryItem): string {
  return [
    item.displayName,
    item.fileName,
    item.quality ?? '',
    item.folderName ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function matchesLibrarySearch(
  item: MediaLibraryItem,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return haystack(item).includes(normalizedQuery);
}

export function filterByAvailability(
  items: readonly MediaLibraryItem[],
): MediaLibraryItem[] {
  return items.filter((item) => isPlayableAvailability(item.localAvailability));
}

export function isRecentlyDownloaded(
  item: MediaLibraryItem,
  nowMs: number,
  windowMs: number = LIBRARY_RECENT_DOWNLOAD_WINDOW_MS,
): boolean {
  if (!item.downloadedAt) {
    return false;
  }
  const time = Date.parse(item.downloadedAt);
  if (!Number.isFinite(time)) {
    return false;
  }
  return nowMs - time <= windowMs && nowMs - time >= 0;
}

export function applyProductFilter(
  items: readonly MediaLibraryItem[],
  input: Pick<
    LibraryQueryInput,
    'filter' | 'quality' | 'folderId' | 'recentDownloadWindowMs' | 'nowMs'
  >,
): MediaLibraryItem[] {
  let next = [...items];

  if (input.filter === 'favorites') {
    next = next.filter((item) => item.favorite);
  } else if (input.filter === 'recently_downloaded') {
    next = next.filter((item) =>
      isRecentlyDownloaded(item, input.nowMs, input.recentDownloadWindowMs),
    );
  } else if (input.filter === 'recently_watched') {
    next = next.filter((item) => item.lastPlayedAt != null);
  } else if (input.filter === 'folder') {
    if (!input.folderId) {
      return [];
    }

    if (input.folderId === UNFILED_FOLDER_SELECTION_ID) {
      next = next.filter((item) => item.folderId === null);
    } else {
      next = next.filter((item) => item.folderId === input.folderId);
    }
  }

  const quality = input.quality?.trim().toLowerCase() ?? '';
  if (quality) {
    next = next.filter(
      (item) => (item.quality ?? '').trim().toLowerCase() === quality,
    );
  }

  return next;
}

function downloadedAtMs(item: MediaLibraryItem): number | null {
  if (!item.downloadedAt) {
    return null;
  }
  const time = Date.parse(item.downloadedAt);
  return Number.isFinite(time) ? time : null;
}

function lastPlayedAtMs(item: MediaLibraryItem): number | null {
  if (!item.lastPlayedAt) {
    return null;
  }
  const time = Date.parse(item.lastPlayedAt);
  return Number.isFinite(time) ? time : null;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

type SortKey = {
  item: MediaLibraryItem;
  index: number;
  downloadedAt: number | null;
  lastPlayedAt: number | null;
  fileSize: bigint;
  displayName: string;
};

function compareNullableDesc(a: number | null, b: number | null): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  return b - a;
}

function compareNullableAsc(a: number | null, b: number | null): number {
  if (a == null && b == null) {
    return 0;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  return a - b;
}

/**
 * Stable deterministic sort. Unknown/missing values sort last, then id.
 * Sort keys are precomputed once — never Date.parse / BigInt inside the comparator.
 * `recently_played` / Recently Watched filter use lastPlayedAt DESC.
 */
export function sortLibraryItems(
  items: readonly MediaLibraryItem[],
  sort: LibrarySort,
): MediaLibraryItem[] {
  const keyed: SortKey[] = items.map((item, index) => ({
    item,
    index,
    downloadedAt: downloadedAtMs(item),
    lastPlayedAt: lastPlayedAtMs(item),
    fileSize: parseByteSize(item.fileSize),
    displayName: item.displayName,
  }));

  keyed.sort((left, right) => {
    let result = 0;

    switch (sort) {
      case 'newest':
        result = compareNullableDesc(left.downloadedAt, right.downloadedAt);
        break;
      case 'oldest':
        result = compareNullableAsc(left.downloadedAt, right.downloadedAt);
        break;
      case 'name_asc': {
        const aEmpty = !left.displayName;
        const bEmpty = !right.displayName;
        if (aEmpty && bEmpty) {
          result = 0;
        } else if (aEmpty) {
          result = 1;
        } else if (bEmpty) {
          result = -1;
        } else {
          result = compareNames(left.displayName, right.displayName);
        }
        break;
      }
      case 'name_desc': {
        const aEmpty = !left.displayName;
        const bEmpty = !right.displayName;
        if (aEmpty && bEmpty) {
          result = 0;
        } else if (aEmpty) {
          result = 1;
        } else if (bEmpty) {
          result = -1;
        } else {
          result = compareNames(right.displayName, left.displayName);
        }
        break;
      }
      case 'largest':
        if (left.fileSize === right.fileSize) {
          result = 0;
        } else {
          result = left.fileSize > right.fileSize ? -1 : 1;
        }
        break;
      case 'smallest':
        if (left.fileSize === right.fileSize) {
          result = 0;
        } else {
          result = left.fileSize < right.fileSize ? -1 : 1;
        }
        break;
      case 'recently_played': {
        result = compareNullableDesc(left.lastPlayedAt, right.lastPlayedAt);
        if (result === 0 && left.lastPlayedAt == null && right.lastPlayedAt == null) {
          result = compareNullableDesc(left.downloadedAt, right.downloadedAt);
        }
        break;
      }
      default:
        result = 0;
    }

    if (result !== 0) {
      return result;
    }
    const idOrder = left.item.id.localeCompare(right.item.id);
    if (idOrder !== 0) {
      return idOrder;
    }
    return left.index - right.index;
  });

  return keyed.map((entry) => entry.item);
}

export function listDistinctQualities(
  items: readonly MediaLibraryItem[],
): string[] {
  const values = new Set<string>();
  for (const item of items) {
    if (item.quality) {
      values.add(item.quality);
    }
  }
  return Array.from(values).sort((a, b) => compareNames(a, b));
}

export function listDistinctFolderIds(
  items: readonly MediaLibraryItem[],
): string[] {
  const values = new Set<string>();
  for (const item of items) {
    if (item.folderId) {
      values.add(item.folderId);
    }
  }
  return Array.from(values);
}

/**
 * Canonical Library Source
 *   → Availability Filter
 *   → Product Filters
 *   → Search
 *   → Sort (Recently Watched forces lastPlayedAt order)
 *   → Visible Items
 */
export function applyLibraryQuery(
  source: readonly MediaLibraryItem[],
  input: LibraryQueryInput,
): LibraryQueryResult {
  const playable = filterByAvailability(source);
  const filtered = applyProductFilter(playable, input);
  const needle = normalizeSearchQuery(input.search);
  const searched = needle
    ? filtered.filter((item) => haystack(item).includes(needle))
    : filtered;
  const sort: LibrarySort =
    input.filter === 'recently_watched' ? 'recently_played' : input.sort;
  const sorted = sortLibraryItems(searched, sort);

  return {
    items: sorted,
    playableCount: playable.length,
    sourceCount: source.length,
  };
}
