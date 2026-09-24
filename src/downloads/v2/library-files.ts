import { Directory, File, Paths } from 'expo-file-system';

import { isUriInside } from '@/downloads/engine/path-guard';
import type { LocalPlaybackRecord } from '@/player/resolve-playback-source';
import { useDownloadsStore } from '@/store/downloads';

/** Native `StoragePaths` writes finished files here (`filesDir/library/<site>/<name>`); nothing else may play. */
function libraryRootUri(): string {
  return new Directory(Paths.document, 'library').uri;
}

/** Native `Thumbnails` writes library thumbnails here (`filesDir/thumbs/<id>.webp`). */
function thumbnailRootUri(): string {
  return new Directory(Paths.document, 'thumbs').uri;
}

/** True for a thumbnail VidoraX generated itself, which is safe to show in its own lists. */
export function isV2ThumbnailUri(uri: string | null | undefined): boolean {
  if (!uri) {
    return false;
  }
  try {
    return isUriInside(thumbnailRootUri(), uri);
  } catch {
    return false;
  }
}

export function isV2LibraryFileUri(uri: string | null | undefined): boolean {
  if (!uri) {
    return false;
  }
  try {
    return isUriInside(libraryRootUri(), uri);
  } catch {
    return false;
  }
}

/**
 * The verified, finalized library file of a completed v2 download. Null while it is not completed, or when its
 * library item is gone (the row is then not playable and no action may claim a file).
 */
export function v2CompletedLibraryFile(
  downloadId: string,
): { localUri: string; fileName: string; expectedBytes: number | null; displayTitle: string; mimeType: string | null } | null {
  const state = useDownloadsStore.getState();
  const item = state.engineRowsById[downloadId];
  const localUri = state.transferById[downloadId]?.localUri ?? null;
  if (!item || item.status !== 'COMPLETED' || !localUri || !isV2LibraryFileUri(localUri)) {
    return null;
  }
  const size = Number(item.fileSize);
  return {
    localUri,
    fileName: item.fileName,
    expectedBytes: Number.isFinite(size) && size > 0 ? size : null,
    displayTitle: item.title,
    mimeType: item.mimeType,
  };
}

/** Player record for a completed v2 download. */
export function v2LibraryPlaybackRecord(downloadId: string): LocalPlaybackRecord | null {
  const file = v2CompletedLibraryFile(downloadId);
  if (!file) {
    return null;
  }
  return {
    downloadId,
    fileName: file.fileName,
    localUri: file.localUri,
    localState: 'complete',
    remoteStatus: 'COMPLETED',
    totalBytes: file.expectedBytes,
    expectedFileSize: file.expectedBytes != null ? String(file.expectedBytes) : '0',
  };
}

/** Existence/size check for a v2 library file (the v1 managed-path rules describe the old download folders). */
export function verifyV2LibraryFile(
  uri: string,
): { ok: true; size: number } | { ok: false; reason: 'missing' | 'corrupt' } {
  if (!isV2LibraryFileUri(uri)) {
    return { ok: false, reason: 'corrupt' };
  }
  try {
    const file = new File(uri);
    if (!file.exists) {
      return { ok: false, reason: 'missing' };
    }
    const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;
    return size > 0 ? { ok: true, size } : { ok: false, reason: 'corrupt' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
}
