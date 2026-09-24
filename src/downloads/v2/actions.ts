import type { DownloadStatus } from '@/api/types';

import type { V2EnginePort } from './engine-port';
import { SOURCE_EXPIRED_MESSAGE } from './source-refresh';

export type EngineDownloadAction = 'pause' | 'resume' | 'retry' | 'cancel';

const ENGINE_MISSING = 'Downloads are unavailable in this build.';

/** Engine failures that mean the stored link is dead, not that the network hiccuped. */
const EXPIRED_ERROR_CODES: ReadonlySet<string> = new Set(['SOURCE_EXPIRED', 'HTTP_403', 'HTTP_404']);

/** A failure only a fresh link from the page can fix: the link expired, was refused or is gone. */
export function needsFreshSource(errorCode: string | null | undefined): boolean {
  return errorCode != null && EXPIRED_ERROR_CODES.has(errorCode);
}

export type RetryEngineDownloadInput = {
  id: string;
  /** The failed row's error code, as the engine reported it. */
  errorCode: string | null;
  /** The content page the download came from, for re-resolving a fresh link. */
  pageUrl: string | null;
};

export type RetryEngineDownloadDeps = {
  engine: V2EnginePort | null;
  /**
   * Re-enqueues this content from a fresh source the live page/session can still supply. Returns the new
   * download id, or null when the page can no longer produce one (the user has navigated away).
   */
  reenqueueFromLiveSource?: (input: RetryEngineDownloadInput) => Promise<string | null>;
};

export type RetryEngineDownloadResult =
  | { ok: true; downloadId: string; refreshed: boolean }
  | { ok: false; reason: 'SOURCE_EXPIRED'; message: string };

/**
 * Retry that is worth tapping.
 *
 * A download that failed because its signed link expired will fail again for exactly the same reason if the
 * same URL is probed again, so that retry is never sent. The live page is asked for a fresh link first; only
 * when it cannot supply one does this refuse, and it says what would actually help. Every other failure —
 * network, storage, a transient server error — retries as before, because re-probing genuinely can succeed.
 */
export async function retryEngineDownload(
  input: RetryEngineDownloadInput,
  deps: RetryEngineDownloadDeps,
): Promise<RetryEngineDownloadResult> {
  if (!deps.engine) {
    throw new Error(ENGINE_MISSING);
  }
  const expired = needsFreshSource(input.errorCode);
  if (!expired) {
    await deps.engine.retry(input.id);
    return { ok: true, downloadId: input.id, refreshed: false };
  }

  const refreshedId = (await deps.reenqueueFromLiveSource?.(input)) ?? null;
  if (refreshedId) {
    return { ok: true, downloadId: refreshedId, refreshed: true };
  }
  return { ok: false, reason: 'SOURCE_EXPIRED', message: SOURCE_EXPIRED_MESSAGE };
}

/** Pause/Resume/Retry/Cancel are the engine's own operations; its state event updates the row. */
export async function runEngineDownloadAction(
  engine: V2EnginePort | null,
  id: string,
  action: EngineDownloadAction,
): Promise<void> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  await engine[action](id);
}

/**
 * Removing a v2 row from Downloads: the download record goes, the finished video does not. A completed
 * download keeps its library item and its file — deleting those is the Player's own delete. An unfinished one
 * is cancelled first, which is what discards its partial file. A record that is already gone (a library-only
 * row) is not an error.
 */
export async function removeEngineDownload(
  engine: V2EnginePort | null,
  id: string,
  status: DownloadStatus | null,
): Promise<void> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  if (status && status !== 'COMPLETED' && status !== 'FAILED' && status !== 'CANCELLED') {
    await engine.cancel(id);
  }
  try {
    await engine.removeDownload(id);
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code !== 'ERR_NOT_FOUND') {
      throw error;
    }
  }
}

/**
 * Renaming a finished v2 video changes the title every list and the player show. The private file keeps its stable
 * name — a rename never moves bytes, so nothing half-renamed can be left behind; the engine announces the change,
 * which updates the Downloads and Player rows. Resolves with the title the library stored (trimmed, clamped).
 */
export async function renameEngineLibraryItem(engine: V2EnginePort | null, id: string, title: string): Promise<string> {
  if (!engine?.renameLibraryItem) {
    throw new Error(ENGINE_MISSING);
  }
  const clean = title.trim();
  if (!clean) {
    throw new Error('Enter a name for this video.');
  }
  const item = await engine.renameLibraryItem(id, clean);
  return item.title;
}

/** A finished v2 video's own favorite; the engine announces the change, which updates every row. */
export async function setEngineFavorite(engine: V2EnginePort | null, id: string, favorite: boolean): Promise<void> {
  if (!engine) {
    throw new Error(ENGINE_MISSING);
  }
  await engine.setFavorite(id, favorite);
}

/**
 * How the page favorite (what the Favorites screen lists) follows a v2 video's own favorite: added when the first
 * video from that page becomes a favorite, removed only when the last favorite from the page is taken away. Null
 * means leave it as it is.
 */
export function pageFavoriteChange(input: {
  favorite: boolean;
  pageFavorited: boolean;
  /** Other videos from the same page that are still favorites. */
  otherFavoritesOnPage: number;
}): 'add' | 'remove' | null {
  if (input.favorite) {
    return input.pageFavorited ? null : 'add';
  }
  return input.pageFavorited && input.otherFavoritesOnPage === 0 ? 'remove' : null;
}
