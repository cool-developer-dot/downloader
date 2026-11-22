/**
 * P6: the pure part of the queue's media index (no library or native imports, so it is unit-tested): how library
 * items are indexed, and #534's "next in its folder".
 */

import type { MediaLibraryItem } from '@/library/types';

export type QueueMediaInfo = {
  id: string;
  title: string;
  durationSeconds: number | null;
  /** The file is known to be missing. */
  missing: boolean;
  /** Library folder id, '' for the top level; null for videos outside the library. */
  folderKey: string | null;
};

export type QueueMediaIndex = ReadonlyMap<string, QueueMediaInfo>;

export const EMPTY_QUEUE_MEDIA_INDEX: QueueMediaIndex = new Map();

/** Library items as the index holds them (pure, so it is unit-tested). */
export function indexLibraryItems(items: readonly Pick<
  MediaLibraryItem,
  'id' | 'displayName' | 'fileName' | 'duration' | 'localAvailability' | 'folderId'
>[]): Map<string, QueueMediaInfo> {
  const index = new Map<string, QueueMediaInfo>();
  for (const item of items) {
    index.set(item.id, {
      id: item.id,
      title: item.displayName || item.fileName,
      durationSeconds: item.duration != null && Number.isFinite(item.duration) && item.duration > 0 ? item.duration : null,
      missing: item.localAvailability === 'missing',
      folderKey: item.folderId ?? '',
    });
  }
  return index;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/**
 * #534 with no queue: the video after this one in its folder, by name ("Episode 2" before "Episode 10"), skipping
 * missing files; null at the end of the folder or for a video outside the library.
 */
export function nextInFolder(index: QueueMediaIndex, mediaId: string | null): string | null {
  const current = mediaId ? index.get(mediaId) : undefined;
  if (!current || current.folderKey == null) {
    return null;
  }
  const siblings = [...index.values()]
    .filter((info) => info.folderKey === current.folderKey)
    .sort((a, b) => compareNames(a.title, b.title) || compareNames(a.id, b.id));
  const at = siblings.findIndex((info) => info.id === current.id);
  for (let i = at + 1; i < siblings.length; i += 1) {
    if (!siblings[i]!.missing) {
      return siblings[i]!.id;
    }
  }
  return null;
}
