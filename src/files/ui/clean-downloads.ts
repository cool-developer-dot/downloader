/**
 * Files F9 · #856 Clean downloads: which downloads a rule picks for clearing (they are previewed, then moved to the
 * Recycle bin). Pure. The rules, combined with AND when several are on:
 * - watched to the end — from watch history (the library item's `completed`);
 * - older than 3, 6 or 12 months — by the download date;
 * - larger than 500 MB.
 * A file that is missing from the phone, or in Private, is never picked.
 */

import type { FileEntry } from '@/files/api';

import { fileBytes } from './file-fields';

export const CLEAN_OLDER_MONTHS = [3, 6, 12] as const;
export type CleanOlderMonths = (typeof CLEAN_OLDER_MONTHS)[number];

export const CLEAN_LARGER_THAN_BYTES = 500 * 1024 * 1024;

export type CleanRules = {
  watched?: boolean;
  olderThanMonths?: CleanOlderMonths | null;
  larger?: boolean;
};

export function hasCleanRule(rules: CleanRules): boolean {
  return Boolean(rules.watched || rules.olderThanMonths || rules.larger);
}

/** `now` minus whole months (the same day of the month, earlier). */
function monthsBefore(now: number, months: number): number {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.getTime();
}

export function cleanCandidates<T extends Pick<FileEntry, 'id' | 'completed' | 'downloadedAt' | 'fileSize' | 'localAvailability'>>(
  files: readonly T[],
  rules: CleanRules,
  options: { now: number; privateIds?: ReadonlySet<string> },
): T[] {
  if (!hasCleanRule(rules)) return [];
  const cutoff = rules.olderThanMonths ? monthsBefore(options.now, rules.olderThanMonths) : null;
  return files.filter((file) => {
    if (file.localAvailability !== 'available') return false;
    if (options.privateIds?.has(file.id)) return false;
    if (rules.watched && file.completed !== true) return false;
    if (cutoff !== null) {
      const at = file.downloadedAt ? Date.parse(file.downloadedAt) : Number.NaN;
      if (Number.isNaN(at) || at >= cutoff) return false;
    }
    if (rules.larger && fileBytes(file) <= CLEAN_LARGER_THAN_BYTES) return false;
    return true;
  });
}
