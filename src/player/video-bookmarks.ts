/**
 * P9 #705 Video Bookmarks: the rules, pure (no storage, no React). The SQL is in
 * `src/storage/repositories/library-stats.queries.ts`; the Player's sheet and timeline dots use these too.
 *
 * - A bookmark is a moment of one video: its position in whole milliseconds, kept inside 0 … the video's length when
 *   that is known (a position past the end is the end), never negative.
 * - Its name is optional: trimmed, inner spaces and line breaks made single spaces, at most 80 characters (Urdu
 *   kept). An empty name is no name: the bookmark is shown by its time.
 * - A video's bookmarks are listed by time; two at the same time keep the order they were added in.
 * - At most 100 per video, so the timeline stays readable.
 */

import { formatPlaybackTime } from './format-time';

export const MAX_BOOKMARK_NAME_LENGTH = 80;

export const MAX_BOOKMARKS_PER_VIDEO = 100;

export type VideoBookmark = {
  id: string;
  mediaId: string;
  positionMs: number;
  /** Null: no name (the time is shown instead). */
  name: string | null;
  createdAt: string;
};

/** The name as stored: null when nothing is left after trimming. */
export function normalizeBookmarkName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const clean = raw.replace(/\s+/g, ' ').trim();
  if (!clean) {
    return null;
  }
  return Array.from(clean).slice(0, MAX_BOOKMARK_NAME_LENGTH).join('').trim();
}

/** Whole milliseconds inside 0 … `durationMs` (no upper bound when the length is unknown). */
export function clampBookmarkPositionMs(positionMs: number, durationMs: number | null | undefined): number {
  const position = Number.isFinite(positionMs) ? Math.max(0, Math.round(positionMs)) : 0;
  if (durationMs != null && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.min(position, Math.round(durationMs));
  }
  return position;
}

/** Seconds (the Player's clock) to the stored milliseconds. */
export function secondsToBookmarkMs(seconds: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
}

/** By time, then the order they were added in, then id (stable). */
export function sortBookmarks(bookmarks: readonly VideoBookmark[]): VideoBookmark[] {
  return [...bookmarks].sort(
    (a, b) =>
      a.positionMs - b.positionMs ||
      (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** "1:23" (or "1:02:03"): where the bookmark is. */
export function bookmarkTimeLabel(bookmark: Pick<VideoBookmark, 'positionMs'>): string {
  return formatPlaybackTime(bookmark.positionMs / 1000);
}

/** What the list and TalkBack call it: its name, or its time when it has none. */
export function bookmarkLabel(bookmark: Pick<VideoBookmark, 'positionMs' | 'name'>): string {
  return bookmark.name ?? bookmarkTimeLabel(bookmark);
}

/**
 * The dots on the timeline: each bookmark as a fraction 0 … 1 of the video's length, in time order, one dot per
 * distinct place. None while the length is unknown (a stream before it loads).
 */
export function bookmarkMarkerFractions(
  bookmarks: readonly Pick<VideoBookmark, 'positionMs'>[],
  durationSeconds: number | null | undefined,
): number[] {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || bookmarks.length === 0) {
    return [];
  }
  const durationMs = durationSeconds * 1000;
  const fractions = new Set<number>();
  for (const bookmark of bookmarks) {
    const fraction = Math.max(0, Math.min(1, bookmark.positionMs / durationMs));
    fractions.add(Math.round(fraction * 1000) / 1000);
  }
  return [...fractions].sort((a, b) => a - b);
}
