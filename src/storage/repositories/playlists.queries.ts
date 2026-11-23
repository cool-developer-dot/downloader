import { TABLE_NAMES } from '@/storage/constants';

import { normalizePlaylistName } from '@/playlists/playlist-names';

/**
 * P7 #617 / #618 — the playlist SQL, over a minimal database interface (tests run it on `node:sqlite` with the app's
 * schema; `playlists.repository.ts` runs it on the app database). Ids and times come in as arguments.
 *
 * Rules: a name is required (trimmed, at most 80 characters). A video is in a playlist at most once: adding it again
 * leaves it where it is and is counted as "already there". Positions are 0, 1, 2… in playlist order and are written
 * again after a removal or a move. Nothing here touches a video's file, or any other table.
 */

type Param = string | number | null;

export type PlaylistsDb = {
  runAsync(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, ...params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: Param[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};

export type Playlist = {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PlaylistItem = {
  playlistId: string;
  mediaId: string;
  position: number;
  /** The video's name when it was added (shown when the video is gone). */
  title: string;
  fileName: string;
  durationSeconds: number | null;
  addedAt: string;
};

export type PlaylistItemInput = {
  mediaId: string;
  title: string;
  fileName: string;
  durationSeconds?: number | null;
};

export type AddItemsResult = { added: number; alreadyThere: number };

export class PlaylistError extends Error {
  code: 'INVALID_NAME' | 'NOT_FOUND';

  constructor(code: 'INVALID_NAME' | 'NOT_FOUND') {
    super(code === 'INVALID_NAME' ? 'A playlist needs a name' : 'No such playlist');
    this.name = 'PlaylistError';
    this.code = code;
  }
}

const P = TABLE_NAMES.playlists;
const I = TABLE_NAMES.playlistItems;

type PlaylistRow = { id: string; name: string; created_at: string; updated_at: string; item_count: number };
type ItemRow = {
  playlist_id: string;
  media_id: string;
  position: number;
  title: string;
  file_name: string;
  duration: number | null;
  added_at: string;
};

const toPlaylist = (row: PlaylistRow): Playlist => ({
  id: row.id,
  name: row.name,
  itemCount: Number(row.item_count ?? 0),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toItem = (row: ItemRow): PlaylistItem => ({
  playlistId: row.playlist_id,
  mediaId: row.media_id,
  position: Number(row.position),
  title: row.title,
  fileName: row.file_name,
  durationSeconds: row.duration == null ? null : Number(row.duration),
  addedAt: row.added_at,
});

const SELECT_PLAYLIST = `SELECT p.id, p.name, p.created_at, p.updated_at,
  (SELECT COUNT(*) FROM ${I} i WHERE i.playlist_id = p.id) AS item_count
  FROM ${P} p`;

function validName(name: string): string {
  const clean = normalizePlaylistName(name);
  if (!clean) {
    throw new PlaylistError('INVALID_NAME');
  }
  return clean;
}

function cleanDuration(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Recently changed first, then by name. */
export async function listPlaylists(db: PlaylistsDb): Promise<Playlist[]> {
  const rows = await db.getAllAsync<PlaylistRow>(`${SELECT_PLAYLIST} ORDER BY p.updated_at DESC, p.name COLLATE NOCASE`);
  return rows.map(toPlaylist);
}

export async function getPlaylist(db: PlaylistsDb, id: string): Promise<Playlist | null> {
  const row = await db.getFirstAsync<PlaylistRow>(`${SELECT_PLAYLIST} WHERE p.id = ?`, id);
  return row ? toPlaylist(row) : null;
}

export async function createPlaylist(
  db: PlaylistsDb,
  input: { id: string; name: string; nowIso: string },
): Promise<Playlist> {
  const name = validName(input.name);
  await db.runAsync(
    `INSERT INTO ${P} (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    input.id,
    name,
    input.nowIso,
    input.nowIso,
  );
  return { id: input.id, name, itemCount: 0, createdAt: input.nowIso, updatedAt: input.nowIso };
}

export async function renamePlaylist(db: PlaylistsDb, id: string, name: string, nowIso: string): Promise<boolean> {
  const clean = validName(name);
  return (await db.runAsync(`UPDATE ${P} SET name = ?, updated_at = ? WHERE id = ?`, clean, nowIso, id)).changes > 0;
}

/**
 * The playlist and its entries (the entries go explicitly too, not only by the foreign key's cascade). Videos and
 * their files are not touched.
 */
export async function deletePlaylist(db: PlaylistsDb, id: string): Promise<boolean> {
  let deleted = false;
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM ${I} WHERE playlist_id = ?`, id);
    deleted = (await db.runAsync(`DELETE FROM ${P} WHERE id = ?`, id)).changes > 0;
  });
  return deleted;
}

export async function listPlaylistItems(db: PlaylistsDb, playlistId: string): Promise<PlaylistItem[]> {
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT * FROM ${I} WHERE playlist_id = ? ORDER BY position, added_at`,
    playlistId,
  );
  return rows.map(toItem);
}

/** The playlists a video is in (the add sheet ticks them). */
export async function playlistIdsWithMedia(db: PlaylistsDb, mediaId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ playlist_id: string }>(
    `SELECT playlist_id FROM ${I} WHERE media_id = ?`,
    mediaId,
  );
  return rows.map((row) => row.playlist_id);
}

async function touch(db: PlaylistsDb, playlistId: string, nowIso: string): Promise<void> {
  await db.runAsync(`UPDATE ${P} SET updated_at = ? WHERE id = ?`, nowIso, playlistId);
}

/** Adds videos at the end, in the given order. One already in the playlist stays where it is. */
export async function addPlaylistItems(
  db: PlaylistsDb,
  playlistId: string,
  inputs: readonly PlaylistItemInput[],
  nowIso: string,
): Promise<AddItemsResult> {
  const result: AddItemsResult = { added: 0, alreadyThere: 0 };
  await db.withTransactionAsync(async () => {
    const exists = await db.getFirstAsync<{ id: string }>(`SELECT id FROM ${P} WHERE id = ?`, playlistId);
    if (!exists) {
      throw new PlaylistError('NOT_FOUND');
    }
    const last = await db.getFirstAsync<{ last: number | null }>(
      `SELECT MAX(position) AS last FROM ${I} WHERE playlist_id = ?`,
      playlistId,
    );
    let position = last?.last == null ? 0 : Number(last.last) + 1;
    for (const input of inputs) {
      const mediaId = input.mediaId.trim();
      if (!mediaId) {
        continue;
      }
      const inserted = await db.runAsync(
        `INSERT OR IGNORE INTO ${I} (playlist_id, media_id, position, title, file_name, duration, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        playlistId,
        mediaId,
        position,
        input.title.trim().slice(0, 300),
        input.fileName.trim().slice(0, 300),
        cleanDuration(input.durationSeconds),
        nowIso,
      );
      if (inserted.changes > 0) {
        result.added += 1;
        position += 1;
      } else {
        result.alreadyThere += 1;
      }
    }
    if (result.added > 0) {
      await touch(db, playlistId, nowIso);
    }
  });
  return result;
}

async function writeOrder(db: PlaylistsDb, playlistId: string, mediaIds: readonly string[]): Promise<void> {
  for (let index = 0; index < mediaIds.length; index += 1) {
    await db.runAsync(
      `UPDATE ${I} SET position = ? WHERE playlist_id = ? AND media_id = ? AND position != ?`,
      index,
      playlistId,
      mediaIds[index]!,
      index,
    );
  }
}

async function orderedIds(db: PlaylistsDb, playlistId: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ media_id: string }>(
    `SELECT media_id FROM ${I} WHERE playlist_id = ? ORDER BY position, added_at`,
    playlistId,
  );
  return rows.map((row) => row.media_id);
}

/** Takes the video out of this playlist only (its file and other playlists are untouched). */
export async function removePlaylistItem(
  db: PlaylistsDb,
  playlistId: string,
  mediaId: string,
  nowIso: string,
): Promise<boolean> {
  let removed = false;
  await db.withTransactionAsync(async () => {
    removed =
      (await db.runAsync(`DELETE FROM ${I} WHERE playlist_id = ? AND media_id = ?`, playlistId, mediaId)).changes > 0;
    if (removed) {
      await writeOrder(db, playlistId, await orderedIds(db, playlistId));
      await touch(db, playlistId, nowIso);
    }
  });
  return removed;
}

/** Moves a video `delta` places (−1 up, +1 down), stopping at either end. False when it didn't move. */
export async function movePlaylistItem(
  db: PlaylistsDb,
  playlistId: string,
  mediaId: string,
  delta: number,
  nowIso: string,
): Promise<boolean> {
  let moved = false;
  await db.withTransactionAsync(async () => {
    const ids = await orderedIds(db, playlistId);
    const from = ids.indexOf(mediaId);
    if (from < 0) {
      return;
    }
    const to = Math.max(0, Math.min(ids.length - 1, from + Math.trunc(delta)));
    if (to === from) {
      return;
    }
    ids.splice(from, 1);
    ids.splice(to, 0, mediaId);
    await writeOrder(db, playlistId, ids);
    await touch(db, playlistId, nowIso);
    moved = true;
  });
  return moved;
}
