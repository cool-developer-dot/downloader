/**
 * Files F6 · search, filters and sort (the search of design 26). Pure: match, then filter, then sort.
 *
 * - Matching looks at the file name, its folder's name, its tags and its note, ignoring case and accents (Urdu's
 *   vowel marks too), and works on Urdu text. "mp4" or ".mp4" also matches the extension (#812).
 * - Files in a locked folder (F10) never match; Private files are not in Files at all (they leave the library).
 * - Filters combine with AND: type (#809), size (#810; 10–100 MB holds exactly 100 MB), date (#811; "7 days" holds a
 *   file from exactly 7 days ago), extension (#812), Old (#823: more than 3, 6 or 12 months ago, default 6) and
 *   Recent (#824: downloaded, renamed or edited in the last 7 days).
 * - Sort (#825): Best match, Name, Date (newest first) or Size (largest first); ties keep their order.
 */

import type { FileType } from '@/files/ui/file-types';

export const MB = 1024 * 1024;
export const GB = 1024 * MB;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SearchItem = {
  id: string;
  name: string;
  type: FileType;
  sizeBytes: number;
  /** When it was downloaded (ISO). */
  date: string | null;
  /** When it was last renamed or edited (ISO), when known. */
  changedAt?: string | null;
  folderId: string | null;
  folderName?: string | null;
  tags?: readonly string[];
  /** F7 #977: the colours of its tags. */
  tagColors?: readonly string[];
  note?: string | null;
};

export const SIZE_BUCKETS = ['under-10mb', '10-100mb', '100mb-1gb', 'over-1gb'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const DATE_RANGES = ['today', '7-days', '30-days', 'this-year'] as const;
export type DateRange = (typeof DATE_RANGES)[number] | { from: string; to: string };

export const OLD_MONTHS = [3, 6, 12] as const;
export type OldMonths = (typeof OLD_MONTHS)[number];
export const DEFAULT_OLD_MONTHS: OldMonths = 6;

export const SEARCH_SORTS = ['best', 'name', 'date', 'size'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export type SearchFilters = {
  types?: readonly FileType[];
  size?: SizeBucket | null;
  date?: DateRange | null;
  extension?: string | null;
  /** Downloaded more than this many months ago. */
  oldMonths?: OldMonths | null;
  recent?: boolean;
  /** F7 #977: files with a tag of this colour. */
  tagColor?: string | null;
  /** F9: larger than this many bytes (Storage's "> 100 MB" chip). */
  minBytes?: number | null;
};

export type SearchInput = {
  query: string;
  filters: SearchFilters;
  sort: SearchSort;
  /** Folder ids whose files never match (locked folders and the folders under them). */
  hiddenFolderIds?: ReadonlySet<string>;
  now: number;
};

export type SearchHit<T extends SearchItem> = {
  item: T;
  /** 0 when nothing was typed; higher is a better match. */
  score: number;
  /** Where the query is in the name (for the bold part), or null when it matched something else. */
  nameMatch: { start: number; end: number } | null;
};

/** Lower case, without accents or vowel marks (é → e, Urdu's zer / zabar / pesh dropped). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLocaleLowerCase();
}

/** Where folded index `at` (and `at + length`) lies in the original text (folding may drop vowel marks). */
export function originalRange(text: string, at: number, length: number): { start: number; end: number } {
  const map: number[] = [];
  let offset = 0;
  for (const character of text) {
    for (let count = foldText(character).length; count > 0; count -= 1) {
      map.push(offset);
    }
    offset += character.length;
  }
  map.push(text.length);
  const start = map[Math.min(at, map.length - 1)] ?? 0;
  const end = map[Math.min(at + length, map.length - 1)] ?? text.length;
  return { start, end };
}

/** "MP4", ".mp4", " mp4 " → "mp4". */
export function normalizeExtension(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^\.+/, '').toLowerCase();
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The extensions present in `items`, for the Extension chip, most common first. */
export function extensionsPresent(items: readonly Pick<SearchItem, 'name'>[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const extension = extensionOf(item.name);
    if (extension) counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([extension]) => extension);
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

export function inSizeBucket(bytes: number, bucket: SizeBucket): boolean {
  switch (bucket) {
    case 'under-10mb':
      return bytes < 10 * MB;
    case '10-100mb':
      return bytes >= 10 * MB && bytes <= 100 * MB;
    case '100mb-1gb':
      return bytes > 100 * MB && bytes <= GB;
    case 'over-1gb':
      return bytes > GB;
    default:
      return true;
  }
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function inDateRange(iso: string | null | undefined, range: DateRange, now: number): boolean {
  const time = ms(iso);
  if (time === null) return false;
  if (typeof range === 'object') {
    const from = ms(range.from);
    const to = ms(range.to);
    // A custom range is whole days: from the start of `from` to the end of `to`.
    return (from === null || time >= startOfDay(from)) && (to === null || time < startOfDay(to) + DAY_MS);
  }
  switch (range) {
    case 'today':
      return time >= startOfDay(now) && time <= now;
    case '7-days':
      return time >= now - 7 * DAY_MS && time <= now;
    case '30-days':
      return time >= now - 30 * DAY_MS && time <= now;
    case 'this-year':
      return new Date(time).getFullYear() === new Date(now).getFullYear() && time <= now;
    default:
      return true;
  }
}

/** Downloaded more than `months` calendar months before `now`. */
export function isOld(iso: string | null | undefined, months: OldMonths, now: number): boolean {
  const time = ms(iso);
  if (time === null) return false;
  const limit = new Date(now);
  limit.setMonth(limit.getMonth() - months);
  return time < limit.getTime();
}

/** Downloaded, renamed or edited in the last 7 days. */
export function isRecent(item: Pick<SearchItem, 'date' | 'changedAt'>, now: number): boolean {
  const latest = Math.max(ms(item.date) ?? -Infinity, ms(item.changedAt) ?? -Infinity);
  return latest >= now - 7 * DAY_MS && latest <= now;
}

function passesFilters(item: SearchItem, filters: SearchFilters, now: number): boolean {
  if (filters.types && filters.types.length > 0 && !filters.types.includes(item.type)) return false;
  if (filters.size && !inSizeBucket(item.sizeBytes, filters.size)) return false;
  if (filters.date && !inDateRange(item.date, filters.date, now)) return false;
  if (filters.extension && extensionOf(item.name) !== normalizeExtension(filters.extension)) return false;
  if (filters.oldMonths && !isOld(item.date, filters.oldMonths, now)) return false;
  if (filters.recent && !isRecent(item, now)) return false;
  if (filters.tagColor && !(item.tagColors ?? []).includes(filters.tagColor)) return false;
  if (filters.minBytes && !(item.sizeBytes > filters.minBytes)) return false;
  return true;
}

/** How well `item` matches the folded query (0: not at all), and where it is in the name. */
function matchScore(item: SearchItem, needle: string, extensionNeedle: string): { score: number; nameMatch: SearchHit<SearchItem>['nameMatch'] } {
  if (!needle) return { score: 1, nameMatch: null };
  const name = foldText(item.name);
  const at = name.indexOf(needle);
  const nameMatch = at >= 0 ? originalRange(item.name, at, needle.length) : null;
  if (at === 0) return { score: 100, nameMatch };
  if (at > 0) {
    const before = name[at - 1] ?? '';
    return { score: /[\s_\-.(]/.test(before) ? 80 : 60, nameMatch };
  }
  if (extensionNeedle && extensionOf(item.name) === extensionNeedle) return { score: 50, nameMatch: null };
  if (item.folderName && foldText(item.folderName).includes(needle)) return { score: 40, nameMatch: null };
  if (item.tags?.some((tag) => foldText(tag).includes(needle))) return { score: 30, nameMatch: null };
  if (item.note && foldText(item.note).includes(needle)) return { score: 20, nameMatch: null };
  return { score: 0, nameMatch: null };
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

/** Match, then filter, then sort. */
export function searchFiles<T extends SearchItem>(items: readonly T[], input: SearchInput): SearchHit<T>[] {
  const needle = foldText(input.query.trim());
  const extensionNeedle = /^\.?[a-z0-9]{1,8}$/i.test(input.query.trim()) ? normalizeExtension(input.query) : '';
  const hidden = input.hiddenFolderIds;
  const hits: { hit: SearchHit<T>; index: number; time: number }[] = [];
  items.forEach((item, index) => {
    if (hidden && item.folderId && hidden.has(item.folderId)) return;
    // The cheap filters first: only the files they keep have their names folded and matched (same result, faster).
    if (!passesFilters(item, input.filters, input.now)) return;
    const { score, nameMatch } = matchScore(item, needle, extensionNeedle);
    if (score === 0) return;
    hits.push({ hit: { item, score, nameMatch }, index, time: ms(item.date) ?? -Infinity });
  });
  hits.sort((a, b) => {
    let order = 0;
    switch (input.sort) {
      case 'best':
        order = b.hit.score - a.hit.score;
        break;
      case 'name':
        order = compareNames(a.hit.item.name, b.hit.item.name);
        break;
      case 'date':
        order = b.time - a.time;
        break;
      case 'size':
        order = b.hit.item.sizeBytes - a.hit.item.sizeBytes;
        break;
      default:
        order = 0;
    }
    return order || a.index - b.index;
  });
  return hits.map((entry) => entry.hit);
}

/** Whether any filter is on (the empty state then offers Clear filters). */
export function hasFilters(filters: SearchFilters): boolean {
  return Boolean(
    (filters.types && filters.types.length > 0) ||
      filters.size ||
      filters.date ||
      filters.extension ||
      filters.oldMonths ||
      filters.recent ||
      filters.tagColor ||
      filters.minBytes,
  );
}
