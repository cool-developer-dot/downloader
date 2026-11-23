import { toStorageError } from '@/storage/types';
import { createId, nowIso } from '@/storage/utils';

// P7: the app database (`vidorax.db`), as media folders — not a browser profile's.
import { getDatabase } from '../sqlite/client';
import {
  addPlaylistItems,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylistItems,
  listPlaylists,
  movePlaylistItem,
  playlistIdsWithMedia,
  PlaylistError,
  removePlaylistItem,
  renamePlaylist,
  type AddItemsResult,
  type Playlist,
  type PlaylistItem,
  type PlaylistItemInput,
} from './playlists.queries';

export type { AddItemsResult, Playlist, PlaylistItem, PlaylistItemInput } from './playlists.queries';
export { PlaylistError } from './playlists.queries';

/** P7 #617 / #618 — playlists in the app database; SQL in playlists.queries.ts. */
export class PlaylistsRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      if (error instanceof PlaylistError) {
        throw error;
      }
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  list(): Promise<Playlist[]> {
    return this.run('read playlists', (db) => listPlaylists(db));
  }

  get(id: string): Promise<Playlist | null> {
    return this.run('read a playlist', (db) => getPlaylist(db, id));
  }

  async create(name: string): Promise<Playlist> {
    const id = await createId();
    return this.run('create a playlist', (db) => createPlaylist(db, { id, name, nowIso: nowIso() }));
  }

  rename(id: string, name: string): Promise<boolean> {
    return this.run('rename a playlist', (db) => renamePlaylist(db, id, name, nowIso()));
  }

  remove(id: string): Promise<boolean> {
    return this.run('delete a playlist', (db) => deletePlaylist(db, id));
  }

  items(id: string): Promise<PlaylistItem[]> {
    return this.run('read a playlist', (db) => listPlaylistItems(db, id));
  }

  addItems(id: string, inputs: readonly PlaylistItemInput[]): Promise<AddItemsResult> {
    return this.run('add to a playlist', (db) => addPlaylistItems(db, id, inputs, nowIso()));
  }

  removeItem(id: string, mediaId: string): Promise<boolean> {
    return this.run('remove from a playlist', (db) => removePlaylistItem(db, id, mediaId, nowIso()));
  }

  moveItem(id: string, mediaId: string, delta: number): Promise<boolean> {
    return this.run('reorder a playlist', (db) => movePlaylistItem(db, id, mediaId, delta, nowIso()));
  }

  playlistIdsWith(mediaId: string): Promise<string[]> {
    return this.run('read playlists', (db) => playlistIdsWithMedia(db, mediaId));
  }
}

export const playlistsRepository = new PlaylistsRepository();
