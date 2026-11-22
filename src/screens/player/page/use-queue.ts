/**
 * P6 Queue & auto-next on the Player screen: the play queue (#619) with Shuffle (#542), Auto Play Next (#534) and its
 * folder fallback, and the Next Episode card's Cancel (#733). What a finished video does is still decided in one place,
 * `decideEndOfPlayback` (run by P5's `use-repeat.ts`), which this feeds.
 */

import { useEffect, useState } from 'react';

import { useAutoPlayNext, useNextEpisodePrompt } from '@/player/auto-next-preference';
import { setPlayQueueCurrent, usePlayQueueStore } from '@/player/play-queue';
import { ensurePlayQueuePersistence } from '@/player/play-queue-persistence';
import {
  EMPTY_QUEUE_MEDIA_INDEX,
  loadQueueMediaIndex,
  nextInFolder,
  type QueueMediaIndex,
} from '@/player/queue-media';

export type PlayerQueueContext = {
  /** The play order (`play-queue.ts` `ids`). */
  queue: readonly string[];
  shuffled: boolean;
  autoPlayNext: boolean;
  nextEpisodePrompt: boolean;
  /** Titles, lengths, missing files and folders of library videos (loaded once per video). */
  index: QueueMediaIndex;
  /** #534 with no queue: the next video of this one's folder. */
  folderNextId: string | null;
  /** #733: the card was cancelled for this video. */
  advanceCancelled: boolean;
  cancelAdvance: () => void;
};

export function usePlayerQueueContext(mediaId: string | null): PlayerQueueContext {
  const queue = usePlayQueueStore((s) => s.ids);
  const shuffled = usePlayQueueStore((s) => s.shuffled);
  const autoPlayNext = useAutoPlayNext();
  const nextEpisodePrompt = useNextEpisodePrompt();

  // The queue knows which video plays (a restored queue and the reopened mini player find their place by it).
  useEffect(() => {
    ensurePlayQueuePersistence();
    setPlayQueueCurrent(mediaId);
  }, [mediaId]);

  const [loaded, setLoaded] = useState<{ mediaId: string | null; index: QueueMediaIndex }>({
    mediaId: null,
    index: EMPTY_QUEUE_MEDIA_INDEX,
  });
  useEffect(() => {
    let alive = true;
    void loadQueueMediaIndex().then((index) => {
      if (alive) {
        setLoaded({ mediaId, index });
      }
    });
    return () => {
      alive = false;
    };
  }, [mediaId]);
  // The index of the previous video still names the same library until the new one loads.
  const index = loaded.index;

  const [cancelledFor, setCancelledFor] = useState<string | null>(null);

  return {
    queue,
    shuffled,
    autoPlayNext,
    nextEpisodePrompt,
    index,
    folderNextId: nextInFolder(index, mediaId),
    advanceCancelled: mediaId != null && cancelledFor === mediaId,
    cancelAdvance: () => setCancelledFor(mediaId),
  };
}
