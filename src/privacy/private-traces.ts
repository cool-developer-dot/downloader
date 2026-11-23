/**
 * P11 #686 — what a video leaves behind outside Private once it has moved there, and how it is all removed. Pure: the
 * stores come in as `PrivateTracesDeps` (the app's in `private-traces.runtime.ts`), so the whole rule is tested.
 *
 * Before P11 the move (H21, `src/private-vault/move-to-private.ts`) already removed the library row (with its
 * favourite and its search entry), the download record, the downloads-store entry, the export receipt, the
 * notifications and the stored playback position. P9's play counts and bookmarks, and H12's tags and notes, went with
 * the library's "deleted" event. What still showed or stayed:
 *
 * - **Playlists (P7)** keep an entry whose video is gone and show it, by its title, as missing.
 * - **The play queue (P6)** kept its id.
 * - **The Player's own memory per video**: saved A-B loops (P5), the fit (P2) and the subtitle choices with any loaded
 *   subtitle copies (P3).
 * - **The playing session**: the Player (or the mini player) still sends `paused` / `playerExited` for the video, which
 *   wrote its position (Watch history, Continue watching) back and could count a play, and the playback coordinator
 *   held it in memory and wrote it again when the next video started.
 *
 * `hidePrivateTraces` removes all of that, and repeats what the move and the "deleted" event already do (play counts,
 * bookmarks, tags, notes, the stored position): each step is safe to run twice, and none depends on another having
 * worked. It never touches the vault or the video's file.
 */

export type PrivateTracesSnapshot = {
  /** The media the app's one player session plays (full Player or mini player); null when none. */
  sessionMediaId: string | null;
  /** A full Player screen shows the session (it then moves on by itself, like P9's Quick Delete). */
  fullPlayerShown: boolean;
  queueIds: readonly string[];
  queueCurrentId: string | null;
};

export type PrivateTracesPlan = {
  /** Only the mini player plays the video: it stops (its file is gone). */
  closeMiniPlayer: boolean;
  /** The video is the queue's current one and no full Player will move on from it: the queue forgets it as current. */
  clearQueueCurrent: boolean;
  /** The video leaves the queue (not while a full Player still shows it as the one playing: the Player does that). */
  removeFromQueue: boolean;
};

/** Pure: what happens to the session and the queue when `mediaId` has moved to Private. */
export function privateTracesPlan(mediaId: string, snapshot: PrivateTracesSnapshot): PrivateTracesPlan {
  if (!mediaId) {
    return { closeMiniPlayer: false, clearQueueCurrent: false, removeFromQueue: false };
  }
  const playing = snapshot.sessionMediaId === mediaId;
  const shownInPlayer = playing && snapshot.fullPlayerShown;
  const isCurrent = snapshot.queueCurrentId === mediaId;
  const queued = snapshot.queueIds.includes(mediaId);
  return {
    closeMiniPlayer: playing && !snapshot.fullPlayerShown,
    clearQueueCurrent: isCurrent && !shownInPlayer,
    removeFromQueue: queued && !(isCurrent && shownInPlayer),
  };
}

export type PrivateTracesDeps = {
  /** Memory only: its playback events are dropped from now on (`private-media-guard.ts`). */
  markMovedToPrivate: (mediaId: string) => void;
  /** The playback coordinator's in-memory session, when it is this video's. */
  dropPlaybackSession: (mediaId: string) => void;
  /** The stored position: Watch history, Continue watching and resume. */
  forgetPlayback: (mediaId: string) => void;
  /** P9: its play count and its video bookmarks (SQLite), then the Library's counts reload. */
  forgetPlayStatsAndBookmarks: (mediaIds: readonly string[]) => Promise<void>;
  /** P7: the playlists it is in, and taking it out of one. */
  playlistsWith: (mediaId: string) => Promise<string[]>;
  removeFromPlaylist: (playlistId: string, mediaId: string) => Promise<unknown>;
  /** P5 / P2 / P3: saved A-B loops, the remembered fit, the subtitle choices and loaded subtitle copies. */
  forgetPlayerChoices: (mediaId: string) => void;
  /** H12 tags and notes, the artist tag. */
  forgetItemNotes: (mediaIds: readonly string[]) => void;
  snapshot: () => PrivateTracesSnapshot;
  closeMiniPlayer: () => void;
  setQueueCurrent: (mediaId: string | null) => void;
  removeFromQueue: (mediaId: string) => void;
};

export type PrivateTracesStep =
  | 'mark'
  | 'session'
  | 'playback'
  | 'queue'
  | 'player-choices'
  | 'notes'
  | 'stats'
  | 'playlists';

export type PrivateTracesReport = {
  plan: PrivateTracesPlan;
  /** Playlists the video was taken out of. */
  playlistsCleared: number;
  /** Steps that threw (the others still ran). */
  failed: PrivateTracesStep[];
};

/**
 * Removes every trace of library item `mediaId`, which has just moved to Private. The first two steps are synchronous
 * (before the first `await`), so no playback event or coordinator write slips in between. Never rejects.
 */
export async function hidePrivateTraces(mediaId: string, deps: PrivateTracesDeps): Promise<PrivateTracesReport> {
  const failed: PrivateTracesStep[] = [];
  const step = (name: PrivateTracesStep, run: () => void) => {
    try {
      run();
    } catch {
      failed.push(name);
    }
  };
  const id = mediaId.trim();
  let plan: PrivateTracesPlan = { closeMiniPlayer: false, clearQueueCurrent: false, removeFromQueue: false };
  if (!id) {
    return { plan, playlistsCleared: 0, failed };
  }

  step('mark', () => deps.markMovedToPrivate(id));
  step('session', () => deps.dropPlaybackSession(id));
  step('queue', () => {
    plan = privateTracesPlan(id, deps.snapshot());
    if (plan.closeMiniPlayer) {
      deps.closeMiniPlayer();
    }
    if (plan.clearQueueCurrent) {
      deps.setQueueCurrent(null);
    }
    if (plan.removeFromQueue) {
      deps.removeFromQueue(id);
    }
  });
  // After the mini player stopped: anything its exit wrote is removed too.
  step('playback', () => deps.forgetPlayback(id));
  step('player-choices', () => deps.forgetPlayerChoices(id));
  step('notes', () => deps.forgetItemNotes([id]));

  try {
    await deps.forgetPlayStatsAndBookmarks([id]);
  } catch {
    failed.push('stats');
  }

  let playlistsCleared = 0;
  try {
    const playlistIds = await deps.playlistsWith(id);
    for (const playlistId of playlistIds) {
      try {
        await deps.removeFromPlaylist(playlistId, id);
        playlistsCleared += 1;
      } catch {
        if (!failed.includes('playlists')) {
          failed.push('playlists');
        }
      }
    }
  } catch {
    failed.push('playlists');
  }

  return { plan, playlistsCleared, failed };
}
