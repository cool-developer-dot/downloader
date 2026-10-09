import { setPlayQueue } from '@/player/play-queue';

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
 * Previous / Next step through it. Without one they stay hidden.
 *
 * Callers only gate on what they can cheaply know — e.g. a file already known
 * to be missing. The authoritative check is `resolvePlaybackSource`, which runs
 * when the player mounts and surfaces a real error, so an optimistic tap fails
 * loudly rather than silently doing nothing.
 */
export function openPlayer(mediaId: string, queue?: readonly string[]): void {
  setPlayQueue(queue);
  navigation.push(playerPath(mediaId));
}
