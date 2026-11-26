/**
 * Files: the two things the screens read from a contract `FileEntry` (a library item) that it doesn't hold as such —
 * the name Files shows and the size in bytes. Pure.
 */

import type { FileEntry } from '@/files/api';

/** The name Files shows: the file's name on the phone, else its title, else its id. */
export function fileLabel(file: Pick<FileEntry, 'id' | 'fileName' | 'displayName'>): string {
  return file.fileName?.trim() || file.displayName?.trim() || file.id;
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
