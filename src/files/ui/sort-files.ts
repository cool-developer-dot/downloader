/**
 * Files F2 · #765 Sort, #766 Ascending / descending, #767 Folders first: the order of a Files list. Pure.
 *
 * Name (A to Z, ignoring case, numbers in number order), Date (when it was downloaded; a folder: when it was made),
 * Size (a folder: everything in it) and Type (the type tiles' order; folders before every file type). An unknown date
 * always goes last. Equal values keep the order they came in (stable), in both directions. With Folders first on, the
 * folders come first, each block sorted; off, folders and files mix in the chosen order.
 */

import { FILE_TYPES, type FileType } from './file-types';
import type { FilesSortDirection, FilesSortKey } from './files-view-settings';

export type SortOptions = {
  sortKey: FilesSortKey;
  sortDirection: FilesSortDirection;
  foldersFirst: boolean;
};

/** What a row is sorted by. */
export type SortFields = {
  isFolder: boolean;
  name: string;
  /** ISO date; null when unknown. */
  date: string | null;
  sizeBytes: number;
  /** A folder sorts by `null`: before every file type. */
  type: FileType | null;
};

function dateMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function typeRank(type: FileType | null): number {
  return type === null ? -1 : FILE_TYPES.indexOf(type);
}

/** -1 / 0 / 1 for `a` before / tied with / after `b`, in the chosen direction (unknown dates last either way). */
export function compareSortFields(a: SortFields, b: SortFields, key: FilesSortKey, direction: FilesSortDirection): number {
  const sign = direction === 'desc' ? -1 : 1;
  switch (key) {
    case 'name':
      return sign * Math.sign(a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    case 'date': {
      const left = dateMs(a.date);
      const right = dateMs(b.date);
      if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
      }
      return sign * Math.sign(left - right);
    }
    case 'size':
      return sign * Math.sign(a.sizeBytes - b.sizeBytes);
    case 'type':
      return sign * Math.sign(typeRank(a.type) - typeRank(b.type));
    default:
      return 0;
  }
}

/** `rows` in the chosen order; `fieldsOf` says what each row is sorted by. Stable on ties. */
export function sortFileRows<T>(rows: readonly T[], fieldsOf: (row: T) => SortFields, options: SortOptions): T[] {
  const keyed = rows.map((row, index) => ({ row, index, fields: fieldsOf(row) }));
  keyed.sort((a, b) => {
    if (options.foldersFirst && a.fields.isFolder !== b.fields.isFolder) {
      return a.fields.isFolder ? -1 : 1;
    }
    return compareSortFields(a.fields, b.fields, options.sortKey, options.sortDirection) || a.index - b.index;
  });
  return keyed.map((entry) => entry.row);
}
