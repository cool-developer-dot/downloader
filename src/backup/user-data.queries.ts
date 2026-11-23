import { TABLE_NAMES } from '@/storage/constants';

import { MAX_BOOKMARKS_PER_VIDEO } from '@/player/video-bookmarks';

import type { BackupPlaylist, BackupPlayStat, BackupVideoBookmark } from './backup-format';

/**
 * P11 #700 — the app database's part of a backup: P7's playlists and their videos, P9's video bookmarks and play
 * counts. Read for the file, written back on restore, over a minimal database interface (tests run it on `node:sqlite`
 * with the app's own schema; `user-data.repository.ts` runs it on the app database). Only these four tables are read
 * or written; columns are always named, so a column a later version adds keeps its default.
 *
 * - **Merge** adds what the file has and nothing on the phone is deleted. A playlist is the same one when it has the
 *   same id, or else the same name (letter case aside); its videos the file has and it hasn't go at its end. A
 *   bookmark is skipped when the phone has its id, or one at the same moment of the same video, or the video's
 *   bookmarks are full (100). A play count keeps the higher count and the later "last played".
 *   Merging the same file twice changes nothing the second time.
 * - **Replace** makes each of these tables, for the sections the file has, exactly what the file holds (playlists
 *   with their videos; bookmarks; play counts). A section the file doesn't have is left alone.
 * Everything runs in one transaction: a restore that fails writes nothing.
 */

type Param = string | number | null;

export type UserDataDb = {
  runAsync(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

export type UserData = {
  playlists: BackupPlaylist[];
  videoBookmarks: BackupVideoBookmark[];
  playStats: BackupPlayStat[];
};

export type UserDataRestore = Partial<UserData>;

export type UserDataRestoreSummary = {
  playlistsAdded: number;
  playlistVideosAdded: number;
  bookmarksAdded: number;
  playCountsChanged: number;
};

const P = TABLE_NAMES.playlists;
const I = TABLE_NAMES.playlistItems;
const V = TABLE_NAMES.videoBookmarks;
const S = TABLE_NAMES.mediaPlayStats;

type PlaylistRow = { id: string; name: string; created_at: string; updated_at: string };
type ItemRow = {
  playlist_id: string;
  media_id: string;
  position: number;
  title: string;
  file_name: string;
  duration: number | null;
  added_at: string;
};
type BookmarkRow = { id: string; media_id: string; position_ms: number; name: string | null; created_at: string };
type StatsRow = { media_id: string; play_count: number; last_played_at: string | null };

/** Everything this part of a backup holds, in a stable order. */
export async function readUserData(db: UserDataDb): Promise<UserData> {
  const playlistRows = await db.getAllAsync<PlaylistRow>(
    `SELECT id, name, created_at, updated_at FROM ${P} ORDER BY created_at, id`,
  );
  const itemRows = await db.getAllAsync<ItemRow>(
    `SELECT playlist_id, media_id, position, title, file_name, duration, added_at FROM ${I}
     ORDER BY playlist_id, position, added_at`,
  );
  const itemsOf = new Map<string, ItemRow[]>();
  for (const row of itemRows) {
    const list = itemsOf.get(row.playlist_id) ?? [];
    list.push(row);
    itemsOf.set(row.playlist_id, list);
  }
  const playlists: BackupPlaylist[] = playlistRows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: (itemsOf.get(row.id) ?? []).map((item, index) => ({
      mediaId: item.media_id,
      position: index,
      title: item.title,
      fileName: item.file_name,
      durationSeconds: item.duration == null ? null : Number(item.duration),
      addedAt: item.added_at,
    })),
  }));
  const bookmarkRows = await db.getAllAsync<BookmarkRow>(
    `SELECT id, media_id, position_ms, name, created_at FROM ${V} ORDER BY media_id, position_ms, created_at, id`,
  );
  const statsRows = await db.getAllAsync<StatsRow>(
    `SELECT media_id, play_count, last_played_at FROM ${S} WHERE play_count > 0 ORDER BY media_id`,
  );
  return {
    playlists,
    videoBookmarks: bookmarkRows.map((row) => ({
      id: row.id,
      mediaId: row.media_id,
      positionMs: Number(row.position_ms),
      name: row.name,
      createdAt: row.created_at,
    })),
    playStats: statsRows.map((row) => ({
      mediaId: row.media_id,
      playCount: Number(row.play_count),
      lastPlayedAt: row.last_played_at,
    })),
  };
}

async function insertItem(db: UserDataDb, playlistId: string, item: BackupPlaylist['items'][number], position: number) {
  return db.runAsync(
    `INSERT OR IGNORE INTO ${I} (playlist_id, media_id, position, title, file_name, duration, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    playlistId,
    item.mediaId,
    position,
    item.title,
    item.fileName,
    item.durationSeconds,
    item.addedAt,
  );
}

async function replacePlaylists(db: UserDataDb, playlists: readonly BackupPlaylist[], summary: UserDataRestoreSummary) {
  // The videos first, then their playlists (the foreign key's cascade isn't relied on).
  await db.runAsync(`DELETE FROM ${I}`);
  await db.runAsync(`DELETE FROM ${P}`);
  for (const playlist of playlists) {
    await db.runAsync(
      `INSERT INTO ${P} (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      playlist.id,
      playlist.name,
      playlist.createdAt,
      playlist.updatedAt,
    );
    summary.playlistsAdded += 1;
    for (const item of playlist.items) {
      if ((await insertItem(db, playlist.id, item, item.position)).changes > 0) {
        summary.playlistVideosAdded += 1;
      }
    }
  }
}

async function mergePlaylists(
  db: UserDataDb,
  playlists: readonly BackupPlaylist[],
  nowIso: string,
  summary: UserDataRestoreSummary,
) {
  const existing = await db.getAllAsync<{ id: string; name: string }>(`SELECT id, name FROM ${P}`);
  const byId = new Map(existing.map((row) => [row.id, row.id]));
  const byName = new Map<string, string>();
  for (const row of existing) {
    const key = row.name.toLocaleLowerCase();
    if (!byName.has(key)) {
      byName.set(key, row.id);
    }
  }
  for (const playlist of playlists) {
    let target = byId.get(playlist.id) ?? byName.get(playlist.name.toLocaleLowerCase()) ?? null;
    const created = !target;
    if (!target) {
      await db.runAsync(
        `INSERT INTO ${P} (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        playlist.id,
        playlist.name,
        playlist.createdAt,
        playlist.updatedAt,
      );
      target = playlist.id;
      byId.set(playlist.id, playlist.id);
      byName.set(playlist.name.toLocaleLowerCase(), playlist.id);
      summary.playlistsAdded += 1;
    }
    const last = await db.getFirstAsync<{ last: number | null }>(
      `SELECT MAX(position) AS last FROM ${I} WHERE playlist_id = ?`,
      target,
    );
    let position = last?.last == null ? 0 : Number(last.last) + 1;
    let added = 0;
    for (const item of playlist.items) {
      if ((await insertItem(db, target, item, position)).changes > 0) {
        position += 1;
        added += 1;
      }
    }
    summary.playlistVideosAdded += added;
    if (added > 0 && !created) {
      // A playlist that was already there changed now; a new one keeps the dates it had.
      await db.runAsync(`UPDATE ${P} SET updated_at = ? WHERE id = ?`, nowIso, target);
    }
  }
}

async function insertBookmark(db: UserDataDb, bookmark: BackupVideoBookmark) {
  return db.runAsync(
    `INSERT OR IGNORE INTO ${V} (id, media_id, position_ms, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    bookmark.id,
    bookmark.mediaId,
    bookmark.positionMs,
    bookmark.name,
    bookmark.createdAt,
  );
}

async function restoreBookmarks(
  db: UserDataDb,
  bookmarks: readonly BackupVideoBookmark[],
  mode: 'merge' | 'replace',
  summary: UserDataRestoreSummary,
) {
  if (mode === 'replace') {
    await db.runAsync(`DELETE FROM ${V}`);
  }
  for (const bookmark of bookmarks) {
    if (mode === 'merge') {
      const same = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM ${V} WHERE id = ? OR (media_id = ? AND position_ms = ?)`,
        bookmark.id,
        bookmark.mediaId,
        bookmark.positionMs,
      );
      if (Number(same?.n ?? 0) > 0) {
        continue;
      }
    }
    const count = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${V} WHERE media_id = ?`, bookmark.mediaId);
    if (Number(count?.n ?? 0) >= MAX_BOOKMARKS_PER_VIDEO) {
      continue;
    }
    if ((await insertBookmark(db, bookmark)).changes > 0) {
      summary.bookmarksAdded += 1;
    }
  }
}

function later(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return Date.parse(b) > Date.parse(a) ? b : a;
}

async function restorePlayStats(
  db: UserDataDb,
  stats: readonly BackupPlayStat[],
  mode: 'merge' | 'replace',
  summary: UserDataRestoreSummary,
) {
  if (mode === 'replace') {
    await db.runAsync(`DELETE FROM ${S}`);
  }
  for (const stat of stats) {
    const current =
      mode === 'merge'
        ? await db.getFirstAsync<StatsRow>(`SELECT media_id, play_count, last_played_at FROM ${S} WHERE media_id = ?`, stat.mediaId)
        : null;
    if (!current) {
      await db.runAsync(
        `INSERT INTO ${S} (media_id, play_count, last_played_at) VALUES (?, ?, ?)`,
        stat.mediaId,
        stat.playCount,
        stat.lastPlayedAt,
      );
      summary.playCountsChanged += 1;
      continue;
    }
    const playCount = Math.max(Number(current.play_count), stat.playCount);
    const lastPlayedAt = later(current.last_played_at, stat.lastPlayedAt);
    if (playCount !== Number(current.play_count) || lastPlayedAt !== current.last_played_at) {
      await db.runAsync(
        `UPDATE ${S} SET play_count = ?, last_played_at = ? WHERE media_id = ?`,
        playCount,
        lastPlayedAt,
        stat.mediaId,
      );
      summary.playCountsChanged += 1;
    }
  }
}

/** Writes a backup's user data, merged or replacing (see above), in one transaction. */
export async function restoreUserData(
  db: UserDataDb,
  data: UserDataRestore,
  mode: 'merge' | 'replace',
  nowIso: string,
): Promise<UserDataRestoreSummary> {
  const summary: UserDataRestoreSummary = { playlistsAdded: 0, playlistVideosAdded: 0, bookmarksAdded: 0, playCountsChanged: 0 };
  await db.withTransactionAsync(async () => {
    if (data.playlists) {
      if (mode === 'replace') {
        await replacePlaylists(db, data.playlists, summary);
      } else {
        await mergePlaylists(db, data.playlists, nowIso, summary);
      }
    }
    if (data.videoBookmarks) {
      await restoreBookmarks(db, data.videoBookmarks, mode, summary);
    }
    if (data.playStats) {
      await restorePlayStats(db, data.playStats, mode, summary);
    }
  });
  return summary;
}
