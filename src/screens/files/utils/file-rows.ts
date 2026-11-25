/**
 * Files F1 · #779 File type icons: what a file row and a folder row show — the type's icon, "size · date" — and the
 * order of a folder's rows (folders first by default; F2's settings choose the sort). Pure.
 */

import type { DsIconName } from '@/design/DsIcon';
import type { FileType } from '@/files/ui/file-types';
import type { FileEntry, FolderEntry, FolderStats } from '@/files/ui/files-index';
import type { InterpolationParams, TranslationKey } from '@/localization/types';

/** One icon per file type; an unknown type gets the plain file. */
export const FILE_TYPE_ICONS: Readonly<Record<FileType, DsIconName>> = {
  video: 'film',
  audio: 'music',
  image: 'image',
  doc: 'file-text',
  archive: 'file-archive',
  apk: 'package',
  other: 'file',
};

export function fileTypeIcon(type: FileType | null | undefined): DsIconName {
  return (type && FILE_TYPE_ICONS[type]) || 'file';
}

/** "1.5 MB" (1024-based, like the rest of the app); null when unknown. */
export function formatFileBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** "Nov 25, 2026" in the app's language; null for a missing or broken date. */
export function formatFileDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** A file row's second line, "size · date", with whatever of the two is known. */
export function fileMetaLine(file: Pick<FileEntry, 'sizeBytes' | 'date'>, locale: string): string {
  const size = file.sizeBytes > 0 ? formatFileBytes(file.sizeBytes) : null;
  return [size, formatFileDate(file.date, locale)].filter((part): part is string => Boolean(part)).join(' · ');
}

type Translate = (key: TranslationKey, params?: InterpolationParams) => string;

/** "1 item" / "{n} items" (a folder's files and subfolders). */
export function itemCountText(count: number, t: Translate): string {
  return count === 1 ? t('fileManager.itemsOne') : t('fileManager.itemsOther', { count });
}

/** "1 file" / "{n} files". */
export function fileCountText(count: number, t: Translate): string {
  return count === 1 ? t('fileManager.filesOne') : t('fileManager.filesOther', { count });
}

/** A folder row's second line, "{n} items · {size}" (no size while it is empty); '' until its stats are known. */
export function folderMetaLine(stats: FolderStats | null | undefined, t: Translate): string {
  if (!stats) {
    return '';
  }
  const size = stats.totalBytes > 0 ? formatFileBytes(stats.totalBytes) : null;
  return [itemCountText(stats.itemCount, t), size].filter((part): part is string => Boolean(part)).join(' · ');
}

export type FolderListEntry =
  | { kind: 'folder'; key: string; folder: FolderEntry }
  | { kind: 'file'; key: string; file: FileEntry };

export function folderEntryOf(folder: FolderEntry): FolderListEntry {
  return { kind: 'folder', key: `folder:${folder.id}`, folder };
}

export function fileEntryOf(file: FileEntry): FolderListEntry {
  return { kind: 'file', key: `file:${file.id}`, file };
}

function compareByName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function nameOf(entry: FolderListEntry): string {
  return entry.kind === 'folder' ? entry.folder.name : entry.file.name;
}

/**
 * A folder screen's rows by name: with `foldersFirst`, the subfolders and then the files; without it, folders and files
 * mixed. Equal names keep their order (stable).
 */
export function folderListEntries(
  folders: readonly FolderEntry[],
  files: readonly FileEntry[],
  options: { foldersFirst: boolean },
): FolderListEntry[] {
  const byName = (list: FolderListEntry[]) =>
    list
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => compareByName(nameOf(a.entry), nameOf(b.entry)) || a.index - b.index)
      .map(({ entry }) => entry);
  const folderRows = folders.map(folderEntryOf);
  const fileRows = files.map(fileEntryOf);
  return options.foldersFirst ? [...byName(folderRows), ...byName(fileRows)] : byName([...folderRows, ...fileRows]);
}
