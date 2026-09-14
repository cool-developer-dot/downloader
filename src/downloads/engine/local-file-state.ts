/**
 * Local file presence for a download job — independent of backend status.
 * Status alone is not enough (e.g. COMPLETED + missing file).
 */

import { Directory, File } from 'expo-file-system';

import {
  getDownloadItemDirectory,
  getRangePartFile,
  verifyCompletedFile,
} from './file-paths';
import { isUriInside } from './path-guard';
import { readPartialFileSize } from './pause-state';
import type { LocalTransferState } from './types';

export type LocalFilePresence =
  | 'no_file'
  | 'partial'
  | 'complete'
  | 'missing'
  | 'invalid';

export type LocalFileAssessment = {
  presence: LocalFilePresence;
  localUri: string | null;
  size: number;
  hasRangePart: boolean;
};

function uriBelongsToDownload(uri: string, downloadId: string): boolean {
  try {
    const dir = getDownloadItemDirectory(downloadId);
    return isUriInside(dir.uri, uri);
  } catch {
    return false;
  }
}

function isFileEntry(entry: Directory | File): entry is File {
  return !(entry instanceof Directory);
}

/**
 * Classify on-disk state for a job. Prefer probing the canonical destination
 * when known; otherwise inspect the job directory.
 */
export function assessLocalFile(options: {
  downloadId: string;
  localUri?: string | null;
  expectedBytes?: number | null;
  preferPartial?: boolean;
}): LocalFileAssessment {
  const { downloadId, expectedBytes } = options;
  const localUri = options.localUri?.trim() || null;

  if (localUri) {
    if (!uriBelongsToDownload(localUri, downloadId)) {
      return {
        presence: 'invalid',
        localUri,
        size: 0,
        hasRangePart: false,
      };
    }

    const file = new File(localUri);
    let hasRangePart = false;
    try {
      hasRangePart = getRangePartFile(file).exists;
    } catch {
      hasRangePart = false;
    }

    if (!file.exists) {
      return {
        presence: 'missing',
        localUri,
        size: 0,
        hasRangePart,
      };
    }

    const verified = verifyCompletedFile(file, expectedBytes ?? null);
    if (verified.ok && !hasRangePart) {
      return {
        presence: 'complete',
        localUri: file.uri || localUri,
        size: verified.size,
        hasRangePart: false,
      };
    }

    const size = readPartialFileSize(file);
    if (size > 0) {
      return {
        presence: hasRangePart || options.preferPartial ? 'partial' : 'invalid',
        localUri: file.uri || localUri,
        size,
        hasRangePart,
      };
    }

    return {
      presence: 'invalid',
      localUri: file.uri || localUri,
      size: 0,
      hasRangePart,
    };
  }

  try {
    const dir = getDownloadItemDirectory(downloadId);
    if (!dir.exists) {
      return { presence: 'no_file', localUri: null, size: 0, hasRangePart: false };
    }
    const entries = dir.list();
    const files = entries.filter(isFileEntry);
    if (files.length === 0) {
      return { presence: 'no_file', localUri: null, size: 0, hasRangePart: false };
    }

    const rangeParts = files.filter((f) => f.name.endsWith('.rangepart'));
    const partTransfers = files.filter((f) => f.name.endsWith('.part'));
    const mains = files.filter(
      (f) =>
        !f.name.endsWith('.rangepart') &&
        !f.name.endsWith('.part'),
    );
    if (partTransfers.length === 1 && mains.length <= 1) {
      const partial = partTransfers[0]!;
      const size = readPartialFileSize(partial);
      if (size > 0) {
        return {
          presence: 'partial',
          localUri: partial.uri,
          size,
          hasRangePart: rangeParts.length > 0,
        };
      }
    }
    if (mains.length === 1) {
      const main = mains[0]!;
      const verified = verifyCompletedFile(main, expectedBytes ?? null);
      if (verified.ok && rangeParts.length === 0) {
        return {
          presence: 'complete',
          localUri: main.uri,
          size: verified.size,
          hasRangePart: false,
        };
      }
      const size = readPartialFileSize(main);
      if (size > 0) {
        return {
          presence: 'partial',
          localUri: main.uri,
          size,
          hasRangePart: rangeParts.length > 0,
        };
      }
    }

    return {
      presence: 'invalid',
      localUri: mains[0]?.uri ?? null,
      size: 0,
      hasRangePart: rangeParts.length > 0,
    };
  } catch {
    return { presence: 'no_file', localUri: null, size: 0, hasRangePart: false };
  }
}

export function presenceToLocalState(
  presence: LocalFilePresence,
): LocalTransferState {
  switch (presence) {
    case 'complete':
      return 'complete';
    case 'partial':
      return 'paused';
    case 'missing':
      return 'missing';
    case 'invalid':
      return 'corrupt';
    case 'no_file':
    default:
      return 'not_started';
  }
}

/** Synchronous Open/Share gate from store/engine snapshot — no FS I/O. */
export function canUseCompletedLocalMedia(options: {
  status: string;
  localUri: string | null | undefined;
  localState: LocalTransferState | null | undefined;
}): boolean {
  if (options.status !== 'COMPLETED') {
    return false;
  }
  if (!options.localUri?.trim()) {
    return false;
  }
  if (
    options.localState === 'missing' ||
    options.localState === 'corrupt' ||
    options.localState === 'deleted'
  ) {
    return false;
  }
  return (
    options.localState === 'complete' || options.localState == null
  );
}
