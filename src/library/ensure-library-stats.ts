/**
 * P9 app-wide wiring, once at startup (app-initializer, next to the playback persistence binder):
 * - #708: the play counter listens to the Player's existing playback events (`subscribePlaybackEvents`; the Player and
 *   its session code are not changed) and stores one more play when `play-count.ts` says so. App-wide, so time in the
 *   mini player counts as well.
 * - #687: the counter skips everything while Disable History is on.
 * - A video deleted from the library takes its play count and bookmarks with it.
 */

import { getV2Engine } from '@/downloads/v2';
import { isWatchHistoryPaused } from '@/playback/history-pause-preference';
import { isExternalMediaId } from '@/player/external-media';
import { subscribePlaybackEvents } from '@/player/playback-events';
import { forgetVideoBookmarks } from '@/player/video-bookmarks-store';
import { isStreamMediaId } from '@/player/remote-stream';

import { refreshPlayCounts } from './library-stats-store';
import { createPlayCountTracker } from './play-count';

const SLOT_KEY = '__vidoraxLibraryStats';

type Slot = { unsubscribe: () => void; libraryListener: { remove(): void } | null };

async function countPlay(mediaId: string, at: number): Promise<void> {
  try {
    const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
    await libraryStatsRepository.recordPlay(mediaId, new Date(at).toISOString());
    await refreshPlayCounts();
  } catch {
    // A play that couldn't be stored is not counted; playback is never disturbed.
  }
}

async function forgetDeleted(ids: readonly string[]): Promise<void> {
  forgetVideoBookmarks(ids);
  try {
    const { libraryStatsRepository } = await import('@/storage/repositories/library-stats.repository');
    await libraryStatsRepository.forget(ids);
    await refreshPlayCounts();
  } catch {
    // Left for now: rows of a gone video are never shown.
  }
}

export function ensureLibraryStats(): void {
  const slots = globalThis as unknown as Record<string, Slot | undefined>;
  // Fast Refresh runs this again: the old listeners go first.
  const previous = slots[SLOT_KEY];
  if (previous) {
    previous.unsubscribe();
    try {
      previous.libraryListener?.remove();
    } catch {
      // already gone
    }
  }

  const tracker = createPlayCountTracker({
    isHistoryPaused: isWatchHistoryPaused,
    isCountable: (mediaId) => !isStreamMediaId(mediaId) && !isExternalMediaId(mediaId),
    onCount: (mediaId, at) => {
      void countPlay(mediaId, at);
    },
  });
  const unsubscribe = subscribePlaybackEvents((event) => tracker.handle(event));

  let libraryListener: Slot['libraryListener'] = null;
  const engine = getV2Engine();
  if (engine) {
    libraryListener = engine.addListener('onLibraryChange', ({ reason, ids }) => {
      if (reason === 'deleted' && ids.length > 0) {
        void forgetDeleted(ids);
      }
    });
  }

  slots[SLOT_KEY] = { unsubscribe, libraryListener };
  void refreshPlayCounts();
}
