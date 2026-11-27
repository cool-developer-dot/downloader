/**
 * Files F8 · design 58: the Recycle bin's words — "Deleted 2 days ago · Deletes in 28 days", the header's
 * "3 items · 30 days", and Keep deleted files' "30 days" / "Until I empty it". Pure: each returns a catalog key and its
 * params, so English and Urdu plurals come from the catalogs.
 */

import type { TranslationKey } from '@/localization/types';

const DAY_MS = 24 * 60 * 60 * 1000;

export type Label = { key: TranslationKey; params?: Record<string, number | string> };

export type KeepDays = 7 | 14 | 30 | 60 | null;

/** Keep deleted files' choices, in the design's order ("Until I empty it" last). */
export const KEEP_DAYS_CHOICES: readonly KeepDays[] = [7, 14, 30, 60, null];

/** Whole calendar-free days between two times (a part day counts as none). */
function wholeDays(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/** "Deleted today" / "Deleted 1 day ago" / "Deleted {count} days ago". */
export function deletedAgoLabel(trashedAt: number, now: number): Label {
  const days = wholeDays(trashedAt, now);
  if (days === 0) return { key: 'fileManager.binDeletedToday' };
  if (days === 1) return { key: 'fileManager.binDeletedDayAgo' };
  return { key: 'fileManager.binDeletedDaysAgo', params: { count: days } };
}

/** "Deletes today" / "Deletes in 1 day" / "Deletes in {count} days"; null when it is kept until the bin is emptied. */
export function deletesInLabel(purgeAt: number | null, now: number): Label | null {
  if (purgeAt === null) return null;
  const days = Math.ceil(Math.max(0, purgeAt - now) / DAY_MS);
  if (days === 0) return { key: 'fileManager.binDeletesToday' };
  if (days === 1) return { key: 'fileManager.binDeletesInDay' };
  return { key: 'fileManager.binDeletesInDays', params: { count: days } };
}

/** Keep deleted files: "7 days" … "60 days", or "Until I empty it". */
export function keepLabel(keepDays: KeepDays): Label {
  return keepDays === null ? { key: 'fileManager.binKeepForever' } : { key: 'fileManager.binKeepDays', params: { days: keepDays } };
}

/** The header: "1 item · 30 days", "{count} items · 30 days", or "… · Until I empty it". */
export function binSubtitleLabels(count: number, keepDays: KeepDays): [Label, Label] {
  const items: Label = count === 1 ? { key: 'fileManager.itemsOne' } : { key: 'fileManager.itemsOther', params: { count } };
  return [items, keepLabel(keepDays)];
}

/** A row's second line: "Deleted 2 days ago · Deletes in 28 days" (just the first part when kept until emptied). */
export function binRowLabels(item: { trashedAt: number; purgeAt: number | null }, now: number): Label[] {
  const deletes = deletesInLabel(item.purgeAt, now);
  return deletes ? [deletedAgoLabel(item.trashedAt, now), deletes] : [deletedAgoLabel(item.trashedAt, now)];
}
