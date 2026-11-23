/**
 * P6: what the queue sheet, the Next Episode card and Auto Play Next need to know about videos by id: a title, a
 * length, whether the file is there, and the video's folder (for #534's "next in its folder" when there is no queue).
 *
 * Library videos come from the library (`getLibrary`), device videos from the device list already read this run.
 * A video's folder is its library folder; videos in no folder share the library's top level. Device videos have no
 * folder here (they always open with their list as the queue).
 */

import { ensureLibraryCompletionBridge, getLibrary } from '@/library';

import { knownDeviceVideo } from './device-media';
import { EMPTY_QUEUE_MEDIA_INDEX, indexLibraryItems, type QueueMediaIndex } from './queue-media-index';

export {
  EMPTY_QUEUE_MEDIA_INDEX,
  indexLibraryItems,
  nextInFolder,
  type QueueMediaIndex,
  type QueueMediaInfo,
} from './queue-media-index';

/** A title for any id: the library's, the device list's, or null. */
export function queueMediaTitle(index: QueueMediaIndex, mediaId: string): string | null {
  return index.get(mediaId)?.title ?? knownDeviceVideo(mediaId)?.title ?? null;
}

export function queueMediaDuration(index: QueueMediaIndex, mediaId: string): number | null {
  const known = index.get(mediaId)?.durationSeconds;
  if (known != null) {
    return known;
  }
  const device = knownDeviceVideo(mediaId)?.durationMs;
  return device != null && device > 0 ? device / 1000 : null;
}

/** Reads the library (no file checks beyond the library's own cached ones). */
export async function loadQueueMediaIndex(): Promise<QueueMediaIndex> {
  try {
    ensureLibraryCompletionBridge();
    const { items } = await getLibrary();
    return indexLibraryItems(items);
  } catch {
    return EMPTY_QUEUE_MEDIA_INDEX;
  }
}
