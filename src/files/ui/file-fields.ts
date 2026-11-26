/**
 * Files: the two things the screens read from a contract `FileEntry` (a library item) that it doesn't hold as such —
 * the name Files shows and the size in bytes. Pure.
 */

import type { FileEntry } from '@/files/api';

import { fileExtension } from './file-types';

/**
 * F5: the name Files shows and renames — the file's title (what Rename changes; the app's own file keeps a stable name
 * on the phone) with the file's extension, so "My trip" stored as `a1b2.mp4` reads "My trip.mp4".
 */
export function fileDisplayName(title: string | null | undefined, fileName: string | null | undefined): string {
  const cleanTitle = title?.trim() ?? '';
  const cleanFile = fileName?.trim() ?? '';
  if (!cleanTitle) {
    return cleanFile;
  }
  const extension = fileExtension(cleanFile);
  if (!extension || cleanTitle.toLowerCase().endsWith(`.${extension}`)) {
    return cleanTitle;
  }
  return `${cleanTitle}.${extension}`;
}

/** The name Files shows: the title with the file's extension (F5), else its id. */
export function fileLabel(file: Pick<FileEntry, 'id' | 'fileName' | 'displayName'>): string {
  return fileDisplayName(file.displayName, file.fileName) || file.id;
}

/** The file's size in bytes (the library keeps a decimal string); 0 when unknown. */
export function fileBytes(file: Pick<FileEntry, 'fileSize'>): number {
  const value = file.fileSize;
  if (!value || !/^\d+$/.test(value)) {
    return 0;
  }
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}
