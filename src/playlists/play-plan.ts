/**
 * P7 #618 — what playing a playlist opens: the first video and the list the Player steps through (the play queue,
 * `src/player/play-queue.ts`). Entries that can't play are left out, so Previous / Next, Repeat all and Auto Play
 * Next skip them. Each video once (a playlist never holds one twice; this keeps the queue's `indexOf` right even so).
 * Pure (tested under Node); `play-playlist.ts` opens the Player with it.
 */

export type PlayableEntry = { mediaId: string; playable: boolean };

export type PlaylistPlayPlan = { startId: string; ids: string[] };

/**
 * `startId`: play from that entry (a tapped row). Null when it can't play, or when nothing in the playlist can.
 * Without it, from the first entry that can play.
 */
export function planPlaylistPlay(
  entries: readonly PlayableEntry[],
  options: { startId?: string | null } = {},
): PlaylistPlayPlan | null {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.playable && !seen.has(entry.mediaId)) {
      seen.add(entry.mediaId);
      ids.push(entry.mediaId);
    }
  }
  if (ids.length === 0) {
    return null;
  }
  if (options.startId != null) {
    return seen.has(options.startId) ? { startId: options.startId, ids } : null;
  }
  return { startId: ids[0]!, ids };
}
