import { Directory, File, Paths } from 'expo-file-system';

import { HLS_TRANSFER } from '@/downloads/engine/hls/constants';
import { getDownloadsRootDirectory } from '@/downloads/engine/file-paths';
import { MULTI_RANGE } from '@/downloads/engine/multi-range/constants';

import type { AppStorageBreakdown } from '../types/storage.types';

const MAX_SCAN_DEPTH = 8;
const MAX_ENTRIES_PER_DIR = 800;

type ScanStats = {
  truncated: boolean;
  errors: boolean;
};

function isDirectory(entry: Directory | File): entry is Directory {
  return entry instanceof Directory;
}

function readFileSize(file: File): number {
  try {
    if (!file.exists) {
      return 0;
    }
    const size = file.size;
    return typeof size === 'number' && Number.isFinite(size) && size > 0
      ? Math.trunc(size)
      : 0;
  } catch {
    return 0;
  }
}

function sumDirectoryBytes(
  dir: Directory,
  depth: number,
  stats: ScanStats,
): number {
  if (depth > MAX_SCAN_DEPTH || !dir.exists) {
    return 0;
  }

  let total = 0;

  let entries: (Directory | File)[];
  try {
    entries = dir.list();
  } catch {
    stats.errors = true;
    return 0;
  }

  if (entries.length > MAX_ENTRIES_PER_DIR) {
    stats.truncated = true;
    entries = entries.slice(0, MAX_ENTRIES_PER_DIR);
  }

  for (const entry of entries) {
    if (isDirectory(entry)) {
      total += sumDirectoryBytes(entry, depth + 1, stats);
      continue;
    }
    total += readFileSize(entry);
  }

  return total;
}

function isTempWorkspaceFolder(name: string): boolean {
  return name === HLS_TRANSFER.workspaceFolderName || name === MULTI_RANGE.workspaceFolderName;
}

function scanDownloadsRoot(stats: ScanStats): { videosBytes: number; tempBytes: number } {
  let videosBytes = 0;
  let tempBytes = 0;

  const root = getDownloadsRootDirectory();
  if (!root.exists) {
    return { videosBytes, tempBytes };
  }

  let itemDirs: Directory[];
  try {
    itemDirs = root.list().filter(isDirectory);
  } catch {
    stats.errors = true;
    return { videosBytes, tempBytes };
  }

  for (const itemDir of itemDirs) {
    let children: (Directory | File)[];
    try {
      children = itemDir.list();
    } catch {
      stats.errors = true;
      continue;
    }

    for (const child of children) {
      if (isDirectory(child)) {
        if (isTempWorkspaceFolder(child.name)) {
          tempBytes += sumDirectoryBytes(child, 0, stats);
        } else {
          tempBytes += sumDirectoryBytes(child, 0, stats);
        }
        continue;
      }

      if (child.name.endsWith('.rangepart')) {
        tempBytes += readFileSize(child);
      } else {
        videosBytes += readFileSize(child);
      }
    }
  }

  return { videosBytes, tempBytes };
}

function scanDocumentsOtherBytes(
  downloadsRoot: Directory,
  stats: ScanStats,
): number {
  const documents = Paths.document;
  if (!documents.exists) {
    return 0;
  }

  let total = 0;
  let entries: (Directory | File)[];
  try {
    entries = documents.list();
  } catch {
    stats.errors = true;
    return 0;
  }

  for (const entry of entries) {
    if (isDirectory(entry)) {
      if (entry.uri === downloadsRoot.uri || entry.name === downloadsRoot.name) {
        continue;
      }
      total += sumDirectoryBytes(entry, 0, stats);
      continue;
    }
    total += readFileSize(entry);
  }

  return total;
}

export function scanAppStorageSync(): AppStorageBreakdown {
  const stats: ScanStats = { truncated: false, errors: false };
  const downloadsRoot = getDownloadsRootDirectory();
  const { videosBytes, tempBytes } = scanDownloadsRoot(stats);

  let cacheBytes = 0;
  try {
    if (Paths.cache.exists) {
      cacheBytes = sumDirectoryBytes(Paths.cache, 0, stats);
    }
  } catch {
    stats.errors = true;
  }

  const otherBytes = scanDocumentsOtherBytes(downloadsRoot, stats);

  // Thumbnails and cached images live in app cache (expo-image disk cache).
  const imagesBytes = 0;

  const totalBytes = videosBytes + tempBytes + cacheBytes + otherBytes + imagesBytes;

  return {
    totalBytes,
    videosBytes,
    imagesBytes,
    cacheBytes,
    tempBytes,
    otherBytes,
    estimated: stats.truncated || stats.errors,
    scanError: stats.errors ? 'partial_scan' : null,
  };
}

/** Yield to the UI thread before running a filesystem scan. */
export async function scanAppStorageAsync(): Promise<AppStorageBreakdown> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  return scanAppStorageSync();
}
