import { playQueueOnOpen, setPlayQueue, usePlayQueueStore } from '@/player/play-queue';
import { ensurePlayQueuePersistence } from '@/player/play-queue-persistence';

import { playerPath } from '../constants/route-paths';

import { navigation } from './navigation';

/**
 * The one way to open the internal player.
 *
 * Library rows/tiles, Continue Watching, Watch History, Home shelves, and
 * download-details Play all funnel through here so the route shape and
 * navigation mode live in one place. File-action sheets do not offer Play —
 * tap the item (or the details Play button) instead.
 *
 * `queue` is the list the item was picked from (in its shown order): the Player's
 * Previous / Next step through it. Without one they stay hidden — unless the item
 * is the one the queue was playing (P6: the mini player reopened, or the last
 * video after a restart), which keeps the queue it had.
 *
 * Callers only gate on what they can cheaply know — e.g. a file already known
 * to be missing. The authoritative check is `resolvePlaybackSource`, which runs
 * when the player mounts and surfaces a real error, so an optimistic tap fails
 * loudly rather than silently doing nothing.
 */
export function openPlayer(mediaId: string, queue?: readonly string[]): void {
  ensurePlayQueuePersistence();
  if (playQueueOnOpen(usePlayQueueStore.getState(), mediaId, queue) === 'replace') {
    setPlayQueue(queue);
  }
  navigation.push(playerPath(mediaId));
}
