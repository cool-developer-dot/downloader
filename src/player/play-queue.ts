/**
 * The list the Player steps through with Previous / Next: the list the video was opened from (the library as shown,
 * the device videos, watch history). Opening from a single place (a download's details, a shelf) leaves no queue, so
 * the buttons stay hidden.
 */

import { createStore } from '@/store/shared/create-store';

type PlayQueueState = {
  ids: readonly string[];
};

export const usePlayQueueStore = createStore<PlayQueueState>()(() => ({ ids: [] }));

export function setPlayQueue(ids: readonly string[] | undefined): void {
  usePlayQueueStore.setState({ ids: ids ? [...ids] : [] });
}

export type PlayQueueNeighbours = { previousId: string | null; nextId: string | null };

export function queueNeighbours(ids: readonly string[], mediaId: string | null): PlayQueueNeighbours {
  const index = mediaId ? ids.indexOf(mediaId) : -1;
  if (index < 0) {
    return { previousId: null, nextId: null };
  }
  return {
    previousId: index > 0 ? ids[index - 1]! : null,
    nextId: index < ids.length - 1 ? ids[index + 1]! : null,
  };
}

export function usePlayQueueNeighbours(mediaId: string | null): PlayQueueNeighbours {
  const ids = usePlayQueueStore((s) => s.ids);
  return queueNeighbours(ids, mediaId);
}
