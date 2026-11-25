/**
 * Files F3 · design 56: the lines of the File details page. Pure.
 *
 * - Format: "MP4 · 640×356" — the container (from the MIME type the library recorded, else the name's extension) and
 *   the picture size when known; an audio file or an unknown size shows the container alone.
 * - Size: tap for the exact number of bytes.
 * - Path: "Files › Movies" — the folders from the Files tab down to the file's own.
 */

import { fileExtension } from '@/files/ui/file-types';
import { libraryFormatLabel } from '@/library/format-label';

/** "640×356" from the library's WIDTHxHEIGHT; null for anything else. */
export function pictureSize(resolution: string | null | undefined): string | null {
  const match = /^([1-9]\d{1,4})\s*[x×]\s*([1-9]\d{1,4})$/i.exec((resolution ?? '').trim());
  return match ? `${match[1]}×${match[2]}` : null;
}

/** The container's short name: "MP4", "MOV", "M4A"…; the extension in capitals when the type is unknown. */
export function containerLabel(mimeType: string | null | undefined, fileName: string | null | undefined): string | null {
  const known = libraryFormatLabel(mimeType);
  if (known) {
    return known;
  }
  const extension = fileExtension(fileName);
  return extension ? extension.toUpperCase() : null;
}

/** The Format row: "MP4 · 640×356", "MP3", or null when nothing is known. */
export function formatLine(input: {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
  resolution: string | null | undefined;
  /** Audio has no picture: its size is never shown. */
  audioOnly: boolean;
}): string | null {
  const container = containerLabel(input.mimeType, input.fileName);
  const size = input.audioOnly ? null : pictureSize(input.resolution);
  const parts = [container, size].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The exact size, with the language's digit grouping ("1,234,567"). */
export function exactBytes(bytes: number, locale: string): string {
  const whole = Math.max(0, Math.trunc(Number.isFinite(bytes) ? bytes : 0));
  try {
    return new Intl.NumberFormat(locale).format(whole);
  } catch {
    return String(whole);
  }
}

/** The Path row: "Files › Movies › 2026" (just "Files" for a file in no folder). Right to left the order is the same. */
export function pathLine(rootLabel: string, folderNames: readonly string[]): string {
  return [rootLabel, ...folderNames].join(' › ');
}
