import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { DownloadEngineError } from './errors';
import { downloadEngine } from './manager';
import {
  assertManagedDownloadPath,
  getDownloadItemDirectory,
} from './file-paths';
import { isUnsafeLogicalFileName } from './path-guard';
import { sanitizeFileName } from './resource-guard';
import { openLocalDownload, shareLocalDownload, assertLocalFileAvailable } from './file-actions';

type MediaFileActionLockKey = string;
const mediaFileLocks = new Map<MediaFileActionLockKey, Promise<void>>();

async function withMediaFileActionLock<T>(
  mediaId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = mediaFileLocks.get(mediaId) ?? Promise.resolve();

  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  mediaFileLocks.set(mediaId, previous.then(() => next));

  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (mediaFileLocks.get(mediaId) === next) {
      mediaFileLocks.delete(mediaId);
    }
  }
}

function assertSafeLogicalFileName(fileName: string): string {
  if (isUnsafeLogicalFileName(fileName)) {
    throw new DownloadEngineError(
      'INVALID_DESTINATION',
      'Unable to rename this file.',
    );
  }
  const sanitized = sanitizeFileName(fileName.trim());
  if (!sanitized || isUnsafeLogicalFileName(sanitized)) {
    throw new DownloadEngineError(
      'INVALID_DESTINATION',
      'Unable to rename this file.',
    );
  }
  return sanitized;
}

export async function openMediaFileById(
  mediaId: string,
  options?: { expectedBytes?: number | null; mimeType?: string | null; fileName?: string },
): Promise<void> {
  // Always refresh first so we never open stale localUri.
  const refreshed = await downloadEngine.refreshCompletedLocalFile(mediaId);
  if (!refreshed.usable || !refreshed.localUri) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'This file is not available on this device.',
    );
  }

  await openLocalDownload(refreshed.localUri, {
    downloadId: mediaId,
    expectedBytes: options?.expectedBytes ?? null,
    mimeType: options?.mimeType ?? null,
    fileName: options?.fileName ?? null,
  });
}

export async function shareMediaFileById(
  mediaId: string,
  options?: {
    expectedBytes?: number | null;
    fileName?: string;
    mimeType?: string | null;
    title?: string | null;
  },
): Promise<void> {
  const refreshed = await downloadEngine.refreshCompletedLocalFile(mediaId);
  if (!refreshed.usable || !refreshed.localUri) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'This file is not available on this device.',
    );
  }

  await shareLocalDownload(refreshed.localUri, options?.fileName, {
    downloadId: mediaId,
    expectedBytes: options?.expectedBytes ?? null,
    mimeType: options?.mimeType ?? null,
    title: options?.title ?? null,
  });
}

export async function renameMediaFileOnDevice(
  mediaId: string,
  nextFileName: string,
): Promise<{ localUri: string }> {
  return withMediaFileActionLock(mediaId, async () => {
    const safeName = assertSafeLogicalFileName(nextFileName);

    const refreshed = await downloadEngine.refreshCompletedLocalFile(mediaId);
    if (!refreshed.usable || !refreshed.localUri) {
      throw new DownloadEngineError(
        'PARTIAL_FILE_MISSING',
        'This file is not available on this device.',
      );
    }

    const sourceUri = refreshed.localUri;
    const sourceFile = assertLocalFileAvailable(sourceUri, {
      downloadId: mediaId,
      expectedBytes: null,
    });

    const dir = getDownloadItemDirectory(mediaId);
    const destinationFile = new File(dir, safeName);
    assertManagedDownloadPath(destinationFile.uri, mediaId);

    if (destinationFile.uri === sourceFile.uri) {
      return { localUri: sourceFile.uri };
    }
    if (destinationFile.exists) {
      throw new DownloadEngineError(
        'INVALID_DESTINATION',
        'A file with this name already exists.',
      );
    }

    // Move + rollback (best-effort): if anything fails after the move,
    // we try to restore the original filename.
    try {
      await sourceFile.move(destinationFile);
    } catch (error) {
      try {
        const destExists = destinationFile.exists;
        const srcExists = sourceFile.exists;
        if (destExists && !srcExists) {
          await destinationFile.move(sourceFile);
        }
      } catch {
        // Rollback best-effort; original error is more actionable.
      }
      throw error;
    }

    // Verify device state truthfully, then publish updated localUri.
    const reRefreshed = await downloadEngine.refreshCompletedLocalFile(mediaId);
    if (!reRefreshed.usable || !reRefreshed.localUri) {
      throw new DownloadEngineError(
        'FINAL_FILE_INVALID',
        'File rename succeeded but the device copy is no longer usable.',
      );
    }

    return { localUri: reRefreshed.localUri };
  });
}

export async function deleteMediaFileOnDevice(mediaId: string): Promise<void> {
  return withMediaFileActionLock(mediaId, async () => {
    // Engine remove is already idempotent: it deletes local files + records safely.
    await downloadEngine.remove(mediaId);
  });
}

// For milestone 2 completeness: helpers for Player handoff later.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolvePlayableMediaUri(
  mediaId: string,
): Promise<{ playableUri: string; localUri: string }> {
  const refreshed = await downloadEngine.refreshCompletedLocalFile(mediaId);
  if (!refreshed.usable || !refreshed.localUri) {
    throw new DownloadEngineError(
      'PARTIAL_FILE_MISSING',
      'This file is not available on this device.',
    );
  }
  // Currently unused by Player (resolvePlaybackSource owns playable URI);
  // retained for Open/Share-adjacent callers that need a content URI.
  const localUri = refreshed.localUri;
  if (Platform.OS === 'android') {
    const file = assertLocalFileAvailable(localUri, {
      downloadId: mediaId,
      expectedBytes: null,
    });
    return { playableUri: file.contentUri, localUri };
  }
  return { playableUri: localUri, localUri };
}

