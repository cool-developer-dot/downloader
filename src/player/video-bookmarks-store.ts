/**
 * P9 #705: the bookmarks of the videos the Player has open, read from and written to `video_bookmarks` (SQLite,
 * `library-stats.repository.ts`). Runtime only; the rules are in `video-bookmarks.ts`.
 */

import { createStore } from '@/store/shared/create-store';

import { sortBookmarks, type VideoBookmark } from './video-bookmarks';

type BookmarksState = { byMediaId: Record<string, readonly VideoBookmark[]> };

export const useVideoBookmarksStore = createStore<BookmarksState>()(() => ({ byMediaId: {} }));

const EMPTY: readonly VideoBookmark[] = [];

export function useVideoBookmarks(mediaId: string | null): readonly VideoBookmark[] {
  return useVideoBookmarksStore((state) => (mediaId ? (state.byMediaId[mediaId] ?? EMPTY) : EMPTY));
}

async function repository() {
  const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
  return libraryStatsRepository;
}

function put(mediaId: string, bookmarks: readonly VideoBookmark[]): void {
  useVideoBookmarksStore.setState((state) => ({ byMediaId: { ...state.byMediaId, [mediaId]: sortBookmarks(bookmarks) } }));
}

/** Reads a video's bookmarks (the Player calls it when a video opens). */
export async function loadVideoBookmarks(mediaId: string): Promise<void> {
  try {
    put(mediaId, await (await repository()).bookmarks(mediaId));
  } catch {
    // None shown; the next open reads them again.
  }
}

export type AddBookmarkOutcome = { ok: true; bookmark: VideoBookmark } | { ok: false; reason: 'full' | 'failed' };

export async function addVideoBookmarkAt(input: {
  mediaId: string;
  positionMs: number;
  durationMs: number | null;
  name: string | null;
}): Promise<AddBookmarkOutcome> {
  try {
    const bookmark = await (await repository()).addBookmark(input);
    const current = useVideoBookmarksStore.getState().byMediaId[input.mediaId] ?? EMPTY;
    put(input.mediaId, [...current, bookmark]);
    return { ok: true, bookmark };
  } catch (error) {
    return { ok: false, reason: (error as { code?: unknown } | null)?.code === 'FULL' ? 'full' : 'failed' };
  }
}

export async function renameVideoBookmarkIn(bookmark: VideoBookmark, name: string | null): Promise<boolean> {
  try {
    const renamed = await (await repository()).renameBookmark(bookmark.id, name);
    await loadVideoBookmarks(bookmark.mediaId);
    return renamed;
  } catch {
    return false;
  }
}

export async function deleteVideoBookmarkIn(bookmark: VideoBookmark): Promise<boolean> {
  try {
    const deleted = await (await repository()).deleteBookmark(bookmark.id);
    const current = useVideoBookmarksStore.getState().byMediaId[bookmark.mediaId] ?? EMPTY;
    put(bookmark.mediaId, current.filter((entry) => entry.id !== bookmark.id));
    return deleted;
  } catch {
    return false;
  }
}

/** A deleted video's bookmarks are dropped from memory too (the rows go in `forgetLibraryStats`). */
export function forgetVideoBookmarks(mediaIds: readonly string[]): void {
  const byMediaId = { ...useVideoBookmarksStore.getState().byMediaId };
  let changed = false;
  for (const id of mediaIds) {
    if (id in byMediaId) {
      delete byMediaId[id];
      changed = true;
    }
  }
  if (changed) {
    useVideoBookmarksStore.setState({ byMediaId });
  }
}
