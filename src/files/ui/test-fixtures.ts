/**
 * Files tests only: a complete library item (the F12 contract's `FileEntry` is a `MediaLibraryItem` plus `fileType`),
 * so a test names just the fields it is about.
 */

import type { MediaLibraryItem } from '@/library/types';

export function libraryItem(overrides: Partial<MediaLibraryItem> & { id: string }): MediaLibraryItem {
  return {
    downloadId: overrides.id,
    displayName: overrides.fileName ?? overrides.id,
    fileName: overrides.id,
    mimeType: null,
    fileSize: '0',
    quality: null,
    resolution: null,
    bitrate: null,
    duration: null,
    downloadedAt: null,
    favorite: false,
    folderId: null,
    folderName: null,
    localAvailability: 'available',
    thumbnailUri: null,
    lastPlayedAt: null,
    progressPercent: null,
    positionSeconds: null,
    completed: false,
    ...overrides,
  };
}
