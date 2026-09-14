import { Paths } from 'expo-file-system';

import { listLocalRecords } from '@/downloads/engine/persistence';

import type { HomeLocalFileMeta } from './home-derive';

/** Cached engine records — AsyncStorage, not a filesystem walk. */
export async function loadHomeLocalFileIndex(): Promise<
  Record<string, HomeLocalFileMeta>
> {
  try {
    const records = await listLocalRecords();
    const map: Record<string, HomeLocalFileMeta> = {};
    for (const record of records) {
      if (record.localState !== 'complete' || !record.downloadId) {
        continue;
      }
      map[record.downloadId] = {
        mediaId: record.downloadId,
        fileName: record.fileName,
        fileSize: record.expectedFileSize,
        updatedAt: record.updatedAt,
      };
    }
    return map;
  } catch {
    return {};
  }
}

/** Single OS free-space query already used by the download engine. */
export function readAvailableDiskBytes(): number | null {
  try {
    const available = Paths.availableDiskSpace;
    if (typeof available === 'number' && Number.isFinite(available) && available >= 0) {
      return Math.trunc(available);
    }
    return null;
  } catch {
    return null;
  }
}
