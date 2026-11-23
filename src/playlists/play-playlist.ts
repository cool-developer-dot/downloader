/**
 * P7 #618 — the one place a playlist starts playing. It goes through the app's play queue (`openPlayer` sets
 * `play-queue.ts`'s list), so Previous / Next, P5's Repeat all and P6's Auto Play Next / shuffle all work on it.
 * There is no second queue.
 */

import { openPlayer } from '@/navigation/helpers/open-player';
import { setPlayQueueCurrent, setPlayQueueShuffle } from '@/player/play-queue';

import { planPlaylistPlay, type PlayableEntry } from './play-plan';

/** False when nothing can play (every video is missing, or the tapped one is). */
export function playPlaylist(
  entries: readonly PlayableEntry[],
  options: { startId?: string | null; shuffle?: boolean } = {},
): boolean {
  const plan = planPlaylistPlay(entries, { startId: options.startId });
  if (!plan) {
    return false;
  }
  if (options.shuffle) {
    // P6 #542: a random first video (unless one was tapped), then the queue's own shuffle around it, so the rest
    // play in a random order and turning Shuffle off in the queue sheet gives the playlist's order back.
    const startId = options.startId ? plan.startId : (plan.ids[Math.floor(Math.random() * plan.ids.length)] ?? plan.startId);
    openPlayer(startId, plan.ids);
    setPlayQueueCurrent(startId);
    setPlayQueueShuffle(true);
    return true;
  }
  openPlayer(plan.startId, plan.ids);
  return true;
}
