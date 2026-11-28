/**
 * Screen 18's first chips: Videos and Audio split the library by what a file is, with the Files tab's own rule
 * (`fileTypeOf`, F12). A video is what the Files Videos tile counts, and audio is what its Audio tile counts. Pictures,
 * documents, archives, apps and unknown files are neither, so they are in neither list and neither count (Faran's
 * decision, 2026-11-28). They stay in the Files tab.
 */
import { fileTypeOf } from '@/files/engine/file-types';
import type { MediaLibraryItem } from '@/library';

export type LibraryKind = 'video' | 'audio';

type KindInput = Pick<MediaLibraryItem, 'mimeType' | 'fileName'>;

/** `video` or `audio` by the Files tab's rule; `null` for every other kind of file. */
export function kindOf(item: KindInput): LibraryKind | null {
  const type = fileTypeOf(item.mimeType, item.fileName ?? '');
  return type === 'video' || type === 'audio' ? type : null;
}

export function isAudioItem(item: KindInput): boolean {
  return kindOf(item) === 'audio';
}

export function itemsOfKind<T extends KindInput>(items: readonly T[], kind: LibraryKind): T[] {
  return items.filter((item) => kindOf(item) === kind);
}

/** Design 18's "{n} videos · {m} songs" line, from the items shown: the same items the two lists hold. */
export function countByKind(items: readonly KindInput[]): {
  videos: number;
  audio: number;
} {
  let videos = 0;
  let audio = 0;
  for (const item of items) {
    const kind = kindOf(item);
    if (kind === 'video') {
      videos += 1;
    } else if (kind === 'audio') {
      audio += 1;
    }
  }
  return { videos, audio };
}

/**
 * The Player's Previous / Next for a row tapped on the Player tab: the tapped item's own list as shown (Videos or
 * Audio, with filter, search and sort applied). An id that isn't shown gets every video and audio file shown. A
 * picture or document is never in the queue.
 */
export function playerQueueFor<T extends KindInput & { id: string }>(id: string, shown: readonly T[]): string[] {
  const tapped = shown.find((item) => item.id === id);
  const kind = tapped ? kindOf(tapped) : null;
  const queue = kind ? itemsOfKind(shown, kind) : shown.filter((item) => kindOf(item) !== null);
  return queue.map((item) => item.id);
}
