/**
 * Deterministic HLS workspace paths under the existing download item directory.
 */

import { Directory, File } from 'expo-file-system';

import { ensureDownloadItemDirectory } from '../file-paths';
import { sanitizeFileName } from '../resource-guard';
import { HLS_TRANSFER } from './constants';

export function getHlsWorkspaceDirectory(downloadId: string): Directory {
  const item = ensureDownloadItemDirectory(downloadId);
  return new Directory(item, HLS_TRANSFER.workspaceFolderName);
}

export function ensureHlsWorkspace(downloadId: string): Directory {
  const dir = getHlsWorkspaceDirectory(downloadId);
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function getHlsSegmentFile(
  downloadId: string,
  index: number,
): File {
  const dir = ensureHlsWorkspace(downloadId);
  const name = `segment-${String(index).padStart(6, '0')}`;
  return new File(dir, sanitizeFileName(name));
}

export function getHlsInitFile(downloadId: string): File {
  const dir = ensureHlsWorkspace(downloadId);
  return new File(dir, 'init.mp4');
}

export function getHlsTempOutputFile(downloadId: string): File {
  const dir = ensureHlsWorkspace(downloadId);
  return new File(dir, sanitizeFileName(HLS_TRANSFER.tempOutputName));
}

export function isReusableHlsFile(file: File): boolean {
  try {
    if (!file.exists) {
      return false;
    }
    const size =
      typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;
    return size > 0 && size <= HLS_TRANSFER.maxSegmentBytes;
  } catch {
    return false;
  }
}

export function readHlsFileSize(file: File): number {
  try {
    if (!file.exists) {
      return 0;
    }
    const size =
      typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : 0;
    return size > 0 ? size : 0;
  } catch {
    return 0;
  }
}

export async function cleanupHlsWorkspace(downloadId: string): Promise<void> {
  try {
    const dir = getHlsWorkspaceDirectory(downloadId);
    if (dir.exists) {
      dir.delete();
    }
  } catch {
    // Cleanup must never throw into transfer flows.
  }
}
