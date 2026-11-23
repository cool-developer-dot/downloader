import { toStorageError } from '@/storage/types';
import { createId, nowIso } from '@/storage/utils';

// P9: the app database (`vidorax.db`), as P7's playlists — not a browser profile's.
import { getDatabase } from '../sqlite/client';
import {
  addVideoBookmark,
  deleteVideoBookmark,
  forgetLibraryStats,
  getPlayStats,
  listPlayStats,
  listVideoBookmarks,
  recordPlay,
  renameVideoBookmark,
  VideoBookmarkError,
  type PlayStats,
  type VideoBookmark,
} from './library-stats.queries';

export type { PlayStats, VideoBookmark } from './library-stats.queries';
export { VideoBookmarkError } from './library-stats.queries';

/** P9 #708 / #626 / #705 — play counts and video bookmarks in the app database; SQL in library-stats.queries.ts. */
export class LibraryStatsRepository {
  private async run<T>(what: string, task: (db: Awaited<ReturnType<typeof getDatabase>>) => Promise<T>): Promise<T> {
    try {
      return await task(await getDatabase());
    } catch (error) {
      if (error instanceof VideoBookmarkError) {
        throw error;
      }
      throw toStorageError(error, `Failed to ${what}`, 'QUERY_FAILED');
    }
  }

  recordPlay(mediaId: string, atIso: string = nowIso()): Promise<PlayStats | null> {
    return this.run('count a play', (db) => recordPlay(db, mediaId, atIso));
  }

  playStats(mediaId: string): Promise<PlayStats | null> {
    return this.run('read a play count', (db) => getPlayStats(db, mediaId));
  }

  allPlayStats(): Promise<PlayStats[]> {
    return this.run('read play counts', (db) => listPlayStats(db));
  }

  bookmarks(mediaId: string): Promise<VideoBookmark[]> {
    return this.run('read bookmarks', (db) => listVideoBookmarks(db, mediaId));
  }

  async addBookmark(input: {
    mediaId: string;
    positionMs: number;
    durationMs?: number | null;
    name?: string | null;
  }): Promise<VideoBookmark> {
    const id = await createId();
    return this.run('add a bookmark', (db) => addVideoBookmark(db, { ...input, id, nowIso: nowIso() }));
  }

  renameBookmark(id: string, name: string | null): Promise<boolean> {
    return this.run('rename a bookmark', (db) => renameVideoBookmark(db, id, name));
  }

  deleteBookmark(id: string): Promise<boolean> {
    return this.run('delete a bookmark', (db) => deleteVideoBookmark(db, id));
  }

  forget(mediaIds: readonly string[]): Promise<number> {
    return this.run('forget deleted videos', (db) => forgetLibraryStats(db, mediaIds));
  }
}

export const libraryStatsRepository = new LibraryStatsRepository();
