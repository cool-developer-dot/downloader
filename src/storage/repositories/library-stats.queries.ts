import { TABLE_NAMES } from '@/storage/constants';

import {
  clampBookmarkPositionMs,
  MAX_BOOKMARKS_PER_VIDEO,
  normalizeBookmarkName,
  type VideoBookmark,
} from '@/player/video-bookmarks';

/**
 * P9 #708 / #626 / #705 — the play-count and video-bookmark SQL, over a minimal database interface (tests run it on
 * `node:sqlite` with the app's schema; `library-stats.repository.ts` runs it on the app database). Ids and times come
 * in as arguments. Nothing here touches a video's file or any other table.
 */

type Param = string | number | null;

export type LibraryStatsDb = {
  runAsync(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null>;
};

export type PlayStats = {
  mediaId: string;
  playCount: number;
  /** When the last counted play was counted (ISO); null when never. */
  lastPlayedAt: string | null;
};

export type { VideoBookmark } from '@/player/video-bookmarks';

export class VideoBookmarkError extends Error {
  code: 'FULL' | 'NO_MEDIA';

  constructor(code: 'FULL' | 'NO_MEDIA') {
    super(code === 'FULL' ? 'This video has the most bookmarks it can have' : 'A bookmark needs a video');
    this.name = 'VideoBookmarkError';
    this.code = code;
  }
}

const S = TABLE_NAMES.mediaPlayStats;
const V = TABLE_NAMES.videoBookmarks;

type StatsRow = { media_id: string; play_count: number; last_played_at: string | null };
type BookmarkRow = { id: string; media_id: string; position_ms: number; name: string | null; created_at: string };

const toStats = (row: StatsRow): PlayStats => ({
  mediaId: row.media_id,
  playCount: Math.max(0, Math.trunc(Number(row.play_count ?? 0))),
  lastPlayedAt: row.last_played_at ?? null,
});

const toBookmark = (row: BookmarkRow): VideoBookmark => ({
  id: row.id,
  mediaId: row.media_id,
  positionMs: Math.max(0, Math.trunc(Number(row.position_ms))),
  name: row.name ?? null,
  createdAt: row.created_at,
});

// ── Play counts (#708, #626) ────────────────────────────────────────────────────────────────────────────────────

/** One more counted play of the video (the first one makes its row), and when. */
export async function recordPlay(db: LibraryStatsDb, mediaId: string, nowIso: string): Promise<PlayStats | null> {
  const id = mediaId.trim();
  if (!id) {
    return null;
  }
  await db.runAsync(
    `INSERT INTO ${S} (media_id, play_count, last_played_at) VALUES (?, 1, ?)
     ON CONFLICT(media_id) DO UPDATE SET play_count = play_count + 1, last_played_at = excluded.last_played_at`,
    id,
    nowIso,
  );
  return getPlayStats(db, id);
}

export async function getPlayStats(db: LibraryStatsDb, mediaId: string): Promise<PlayStats | null> {
  const row = await db.getFirstAsync<StatsRow>(`SELECT * FROM ${S} WHERE media_id = ?`, mediaId);
  return row ? toStats(row) : null;
}

/** Every video with a counted play: most played first, then the most recently counted, then id. */
export async function listPlayStats(db: LibraryStatsDb): Promise<PlayStats[]> {
  const rows = await db.getAllAsync<StatsRow>(
    `SELECT * FROM ${S} WHERE play_count > 0 ORDER BY play_count DESC, last_played_at DESC, media_id`,
  );
  return rows.map(toStats);
}

// ── Lengths (#711 backfill) ─────────────────────────────────────────────────────────────────────────────────────

export type MediaLength = {
  mediaId: string;
  /** Null: looked at, but no length could be read. */
  durationMs: number | null;
  checkedAt: string;
};

type LengthRow = { media_id: string; duration_ms: number | null; duration_checked_at: string };

/**
 * Keeps a video's measured length (null: none could be read) and when it was looked at. A length already known is
 * never replaced by "unknown"; the play count is never touched (a new row starts at 0, which isn't a play).
 */
export async function saveMediaLength(
  db: LibraryStatsDb,
  mediaId: string,
  durationMs: number | null,
  nowIso: string,
): Promise<void> {
  const id = mediaId.trim();
  if (!id) {
    return;
  }
  const length = durationMs != null && Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : null;
  await db.runAsync(
    `INSERT INTO ${S} (media_id, play_count, duration_ms, duration_checked_at) VALUES (?, 0, ?, ?)
     ON CONFLICT(media_id) DO UPDATE SET
       duration_ms = COALESCE(excluded.duration_ms, duration_ms),
       duration_checked_at = excluded.duration_checked_at`,
    id,
    length,
    nowIso,
  );
}

/** Every video the backfill has looked at, with its length (or null). */
export async function listMediaLengths(db: LibraryStatsDb): Promise<MediaLength[]> {
  const rows = await db.getAllAsync<LengthRow>(
    `SELECT media_id, duration_ms, duration_checked_at FROM ${S} WHERE duration_checked_at IS NOT NULL ORDER BY media_id`,
  );
  return rows.map((row) => ({
    mediaId: row.media_id,
    durationMs: row.duration_ms != null && Number(row.duration_ms) > 0 ? Math.trunc(Number(row.duration_ms)) : null,
    checkedAt: row.duration_checked_at,
  }));
}

// ── Video bookmarks (#705) ──────────────────────────────────────────────────────────────────────────────────────

/** A video's bookmarks by time (two at the same time: the order they were added in). */
export async function listVideoBookmarks(db: LibraryStatsDb, mediaId: string): Promise<VideoBookmark[]> {
  const rows = await db.getAllAsync<BookmarkRow>(
    `SELECT * FROM ${V} WHERE media_id = ? ORDER BY position_ms, created_at, id`,
    mediaId,
  );
  return rows.map(toBookmark);
}

/**
 * Adds a bookmark at `positionMs` (kept inside 0 … `durationMs` when the length is known), with an optional name.
 * Refused when the video already has the most it can have.
 */
export async function addVideoBookmark(
  db: LibraryStatsDb,
  input: { id: string; mediaId: string; positionMs: number; durationMs?: number | null; name?: string | null; nowIso: string },
): Promise<VideoBookmark> {
  const mediaId = input.mediaId.trim();
  if (!mediaId) {
    throw new VideoBookmarkError('NO_MEDIA');
  }
  const count = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${V} WHERE media_id = ?`, mediaId);
  if (Number(count?.n ?? 0) >= MAX_BOOKMARKS_PER_VIDEO) {
    throw new VideoBookmarkError('FULL');
  }
  const bookmark: VideoBookmark = {
    id: input.id,
    mediaId,
    positionMs: clampBookmarkPositionMs(input.positionMs, input.durationMs ?? null),
    name: normalizeBookmarkName(input.name),
    createdAt: input.nowIso,
  };
  await db.runAsync(
    `INSERT INTO ${V} (id, media_id, position_ms, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    bookmark.id,
    bookmark.mediaId,
    bookmark.positionMs,
    bookmark.name,
    bookmark.createdAt,
  );
  return bookmark;
}

/** A new name (empty: back to no name, shown by its time). False when there is no such bookmark. */
export async function renameVideoBookmark(db: LibraryStatsDb, id: string, name: string | null): Promise<boolean> {
  return (await db.runAsync(`UPDATE ${V} SET name = ? WHERE id = ?`, normalizeBookmarkName(name), id)).changes > 0;
}

export async function deleteVideoBookmark(db: LibraryStatsDb, id: string): Promise<boolean> {
  return (await db.runAsync(`DELETE FROM ${V} WHERE id = ?`, id)).changes > 0;
}

// ── A video deleted from the library ────────────────────────────────────────────────────────────────────────────

/** Its play count and its bookmarks go with it (nothing else is touched). */
export async function forgetLibraryStats(db: LibraryStatsDb, mediaIds: readonly string[]): Promise<number> {
  let removed = 0;
  for (const raw of mediaIds) {
    const id = raw.trim();
    if (!id) {
      continue;
    }
    removed += (await db.runAsync(`DELETE FROM ${S} WHERE media_id = ?`, id)).changes;
    removed += (await db.runAsync(`DELETE FROM ${V} WHERE media_id = ?`, id)).changes;
  }
  return removed;
}
