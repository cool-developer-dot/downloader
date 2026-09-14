/**
 * Deterministic multi-range part / merge paths under the download item directory.
 */

import { Directory, File } from 'expo-file-system';

import { ensureDownloadItemDirectory } from '../file-paths';
import { sanitizeFileName } from '../resource-guard';
import { MULTI_RANGE } from './constants';

export function getMultiRangeWorkspace(downloadId: string): Directory {
  const item = ensureDownloadItemDirectory(downloadId);
  return new Directory(item, MULTI_RANGE.workspaceFolderName);
}

export function ensureMultiRangeWorkspace(downloadId: string): Directory {
  const dir = getMultiRangeWorkspace(downloadId);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function getMultiRangePartFile(downloadId: string, index: number): File {
  const dir = ensureMultiRangeWorkspace(downloadId);
  const name = `part-${String(Math.trunc(index)).padStart(3, '0')}`;
  return new File(dir, sanitizeFileName(name));
}

export function getMultiRangeMergeTempFile(downloadId: string): File {
  const dir = ensureMultiRangeWorkspace(downloadId);
  return new File(dir, sanitizeFileName(MULTI_RANGE.mergeTempName));
}

export function readPartFileSize(file: File): number {
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

export async function cleanupMultiRangeWorkspace(downloadId: string): Promise<void> {
  try {
    const dir = getMultiRangeWorkspace(downloadId);
    if (dir.exists) {
      dir.delete();
    }
  } catch {
    // Cleanup must never throw into transfer flows.
  }
}
