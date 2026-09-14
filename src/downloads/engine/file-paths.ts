import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { hardeningLog } from '../hardening-diagnostics';
import { DOWNLOAD_ENGINE, TRANSFER_PARTIAL_SUFFIX } from './constants';
import { DownloadEngineError } from './errors';
import { isUriInside } from './path-guard';
import { resolveDownloadFileName, sanitizeFileName } from './resource-guard';

export function getDownloadsRootDirectory(): Directory {
  return new Directory(Paths.document, DOWNLOAD_ENGINE.rootFolderName);
}

export function ensureDownloadsRoot(): Directory {
  const root = getDownloadsRootDirectory();
  if (!root.exists) {
    root.create({ intermediates: true, idempotent: true });
  }
  return root;
}

export function getDownloadItemDirectory(downloadId: string): Directory {
  const safeId = sanitizeFileName(downloadId);
  return new Directory(ensureDownloadsRoot(), safeId);
}

export function ensureDownloadItemDirectory(downloadId: string): Directory {
  const dir = getDownloadItemDirectory(downloadId);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function resolveDestinationFile(
  downloadId: string,
  fileName: string,
  extras?: { mimeType?: string | null; sourceUrl?: string | null },
): File {
  const dir = ensureDownloadItemDirectory(downloadId);
  const file = new File(
    dir,
    resolveDownloadFileName({
      fileName,
      mimeType: extras?.mimeType,
      sourceUrl: extras?.sourceUrl,
    }),
  );
  assertManagedDownloadPath(file.uri, downloadId);
  return file;
}

/** Final catalog path + same-directory `.part` transfer workspace. */
export function resolveTransferTargets(
  downloadId: string,
  fileName: string,
  extras?: { mimeType?: string | null; sourceUrl?: string | null },
): { final: File; partial: File } {
  const final = resolveDestinationFile(downloadId, fileName, extras);
  const partial = getPartialTransferFile(final);
  assertManagedDownloadPath(partial.uri, downloadId);
  return { final, partial };
}

/** In-progress progressive bytes — `{name}.part` beside the final file. */
export function getPartialTransferFile(finalFile: File): File {
  return new File(
    finalFile.parentDirectory,
    `${finalFile.name}${TRANSFER_PARTIAL_SUFFIX}`,
  );
}

export function isPartialTransferPath(
  uri: string | null | undefined,
  fileName?: string | null,
): boolean {
  const haystack = `${uri ?? ''} ${fileName ?? ''}`.toLowerCase();
  return haystack.includes(TRANSFER_PARTIAL_SUFFIX);
}

const FILE_COMMIT_CHUNK_BYTES = 256 * 1024;

function copyFileChunked(source: File, destination: File): void {
  if (!source.exists) {
    throw new Error('source_missing');
  }
  try {
    if (destination.exists) {
      destination.delete();
    }
  } catch {
    // WriteOnly may overwrite on some platforms.
  }

  const reader = source.open(FileMode.ReadOnly);
  const writer = destination.open(FileMode.WriteOnly);
  try {
    while (true) {
      const chunk = reader.readBytes(FILE_COMMIT_CHUNK_BYTES);
      if (!chunk || chunk.byteLength === 0) {
        break;
      }
      writer.writeBytes(chunk);
    }
  } finally {
    try {
      reader.close();
    } catch {
      // ignore
    }
    try {
      writer.close();
    } catch {
      // ignore
    }
  }
}

export function deletePartialTransferQuiet(partial: File): void {
  try {
    if (partial.exists) {
      partial.delete();
    }
  } catch {
    // ignore
  }
}

export function deleteFinalQuiet(final: File): void {
  try {
    if (final.exists) {
      final.delete();
    }
  } catch {
    // ignore
  }
}

/**
 * Move legacy incomplete bytes that were written directly to the final path
 * into the `.part` workspace (one-time migration per job).
 */
export function migrateLegacyFinalToPartial(final: File, partial: File): boolean {
  if (partial.exists) {
    return false;
  }
  if (!final.exists) {
    return false;
  }
  const size =
    typeof final.size === 'number' && Number.isFinite(final.size)
      ? Math.trunc(final.size)
      : 0;
  if (size <= 0) {
    return false;
  }
  try {
    copyFileChunked(final, partial);
    const partialSize =
      typeof partial.size === 'number' && Number.isFinite(partial.size)
        ? Math.trunc(partial.size)
        : 0;
    if (partialSize !== size) {
      deletePartialTransferQuiet(partial);
      return false;
    }
    deleteFinalQuiet(final);
    return true;
  } catch {
    deletePartialTransferQuiet(partial);
    return false;
  }
}

/**
 * After validation: copy partial → final in same directory, then remove partial.
 * Not a kernel-level atomic rename — same app-private directory, no cross-volume copy.
 */
export function commitPartialToFinalFile(
  partial: File,
  final: File,
): { ok: true; size: number } | { ok: false; reason: string } {
  if (!partial.exists) {
    return { ok: false, reason: 'missing_partial' };
  }
  const partialSize =
    typeof partial.size === 'number' && Number.isFinite(partial.size)
      ? Math.trunc(partial.size)
      : 0;
  if (partialSize <= 0) {
    return { ok: false, reason: 'empty_partial' };
  }

  try {
    copyFileChunked(partial, final);
  } catch {
    deleteFinalQuiet(final);
    return { ok: false, reason: 'copy_failed' };
  }

  const finalSize =
    typeof final.size === 'number' && Number.isFinite(final.size)
      ? Math.trunc(final.size)
      : 0;
  if (finalSize <= 0 || finalSize !== partialSize) {
    deleteFinalQuiet(final);
    return { ok: false, reason: 'size_mismatch' };
  }

  deletePartialTransferQuiet(partial);
  deleteRangePartQuiet(final);
  return { ok: true, size: finalSize };
}

/**
 * Idempotent cleanup of everything owned by a download ID.
 * Safe when the directory/file is already gone.
 */
export async function deleteDownloadFiles(downloadId: string): Promise<void> {
  try {
    const dir = getDownloadItemDirectory(downloadId);
    if (dir.exists) {
      dir.delete();
    }
  } catch {
    // Cleanup must never throw into UI flows.
  }
  // Second call / race: still succeed.
  try {
    const dir = getDownloadItemDirectory(downloadId);
    if (dir.exists) {
      dir.delete();
    }
  } catch {
    // ignore
  }
}


export function getRangePartFile(destination: File): File {
  return new File(destination.parentDirectory, `${destination.name}.rangepart`);
}

export function deleteRangePartQuiet(destination: File): void {
  try {
    const temp = getRangePartFile(destination);
    if (temp.exists) {
      temp.delete();
    }
  } catch {
    // ignore
  }
}

export function assertValidDestination(destination: File): void {
  try {
    const parent = destination.parentDirectory;
    if (!parent.exists) {
      parent.create({ intermediates: true, idempotent: true });
    }
    if (!parent.exists) {
      throw new DownloadEngineError(
        'INVALID_DESTINATION',
        'Unable to save this file to storage.',
      );
    }
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    throw new DownloadEngineError(
      'INVALID_DESTINATION',
      'Unable to save this file to storage.',
    );
  }
}

/**
 * Ensure a resolved URI stays under the VidoraX-managed downloads root.
 * Rejects path traversal / absolute escapes / prefix-sibling attacks.
 */
export function assertManagedDownloadPath(
  candidateUri: string,
  downloadId: string,
): void {
  const root = getDownloadsRootDirectory();
  const item = getDownloadItemDirectory(downloadId);

  if (
    !isUriInside(root.uri, candidateUri) ||
    !isUriInside(item.uri, candidateUri)
  ) {
    hardeningLog('security.path_blocked', { downloadId }, 'warn');
    throw new DownloadEngineError(
      'INVALID_DESTINATION',
      'Unable to save this file to storage.',
    );
  }
}

/**
 * Precheck free disk against remaining bytes + safety margin when API is available.
 * Prefer remaining = expected - partial for resumes; fall back to full expected.
 */
export function assertEnoughDiskSpace(requiredBytes: number): void {
  assertEnoughDiskSpaceForTransfer({
    expectedTotalBytes: requiredBytes,
    partialBytes: 0,
  });
}

export function assertEnoughDiskSpaceForTransfer(options: {
  expectedTotalBytes?: number | null;
  partialBytes?: number | null;
}): void {
  try {
    const available = Paths.availableDiskSpace;
    const expected =
      typeof options.expectedTotalBytes === 'number' &&
      Number.isFinite(options.expectedTotalBytes) &&
      options.expectedTotalBytes > 0
        ? Math.trunc(options.expectedTotalBytes)
        : 0;
    const partial =
      typeof options.partialBytes === 'number' &&
      Number.isFinite(options.partialBytes) &&
      options.partialBytes > 0
        ? Math.trunc(options.partialBytes)
        : 0;
    const remaining =
      expected > 0 ? Math.max(0, expected - partial) : Math.max(0, expected);
    const need = remaining + DOWNLOAD_ENGINE.diskSafetyMarginBytes;

    if (
      typeof available === 'number' &&
      Number.isFinite(available) &&
      available < Math.max(need, DOWNLOAD_ENGINE.minFreeDiskBytes)
    ) {
      throw new DownloadEngineError(
        'INSUFFICIENT_STORAGE',
        'Not enough storage space to complete this download.',
      );
    }
  } catch (error) {
    if (error instanceof DownloadEngineError) {
      throw error;
    }
    // Disk space probe unavailable — proceed and let write fail truthfully.
  }
}

export function verifyCompletedFile(
  file: File,
  expectedBytes: number | null,
  options?: { downloadId?: string },
): { ok: true; size: number } | { ok: false; reason: 'missing' | 'corrupt' } {
  try {
    if (!file.exists) {
      return { ok: false, reason: 'missing' };
    }

    if (options?.downloadId) {
      const dir = getDownloadItemDirectory(options.downloadId);
      if (!isUriInside(dir.uri, file.uri)) {
        return { ok: false, reason: 'corrupt' };
      }
    }

    const size =
      typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;

    if (size <= 0) {
      return { ok: false, reason: 'corrupt' };
    }

    if (file.name.includes('.part') || file.uri.toLowerCase().includes('.part')) {
      return { ok: false, reason: 'corrupt' };
    }

    // Leftover range temp means finalize did not complete.
    try {
      const rangePart = getRangePartFile(file);
      if (rangePart.exists) {
        return { ok: false, reason: 'corrupt' };
      }
    } catch {
      // ignore probe failure; size checks below still apply
    }

    if (expectedBytes != null && expectedBytes > 0) {
      const expected = Math.trunc(expectedBytes);
      // Exact match when size is known; allow 1 KiB tolerance for encoding edge cases.
      if (Math.abs(size - expected) > 1024) {
        return { ok: false, reason: 'corrupt' };
      }
    }

    return { ok: true, size };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

/**
 * Validate a partial file for Range resume reuse.
 */
export function verifyPartialForRetry(
  file: File,
  expectedUri: string | null,
): { ok: true; size: number } | { ok: false; reason: 'missing' | 'corrupt' | 'mismatch' } {
  try {
    if (!file.exists) {
      return { ok: false, reason: 'missing' };
    }
    if (expectedUri && file.uri !== expectedUri) {
      return { ok: false, reason: 'mismatch' };
    }
    const size =
      typeof file.size === 'number' && Number.isFinite(file.size)
        ? Math.trunc(file.size)
        : 0;
    if (size <= 0) {
      return { ok: false, reason: 'corrupt' };
    }
    return { ok: true, size };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}
