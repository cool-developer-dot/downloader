/**
 * Screen 18's first chips: Videos and Audio split the library by what a file is. Audio is a sound-only file (an
 * extracted .m4a, a downloaded .mp3); everything else, and anything unknown, is a video, as before.
 */
import type { MediaLibraryItem } from '@/library';

export type LibraryKind = 'video' | 'audio';

const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'wma', 'amr']);

export function isAudioItem(item: Pick<MediaLibraryItem, 'mimeType' | 'fileName'>): boolean {
  const mime = item.mimeType?.toLowerCase() ?? '';
  if (mime.startsWith('audio/')) {
    return true;
  }
  if (mime.startsWith('video/')) {
    return false;
  }
  const extension = item.fileName?.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.has(extension);
}

export function itemsOfKind<T extends Pick<MediaLibraryItem, 'mimeType' | 'fileName'>>(
  items: readonly T[],
  kind: LibraryKind,
): T[] {
  return items.filter((item) => isAudioItem(item) === (kind === 'audio'));
}

/** Design 18's "{n} videos · {m} songs" line, from the items shown. */
export function countByKind(items: readonly Pick<MediaLibraryItem, 'mimeType' | 'fileName'>[]): {
  videos: number;
  audio: number;
} {
  let audio = 0;
  for (const item of items) {
    if (isAudioItem(item)) {
      audio += 1;
    }
  }
  return { videos: items.length - audio, audio };
}
