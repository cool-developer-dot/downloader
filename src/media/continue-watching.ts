/** The fields of `PlaybackState` (src/playback/persistence.ts) that the Library shelves need. */
export interface SavedPlayback {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  lastPlayedAt: string | null;
}

// Same thresholds the player uses for resume and near-end completion (src/playback/constants.ts).
const MIN_RESUME_SECONDS = 15;
const COMPLETED_FRACTION = 0.95;
const COMPLETED_REMAINING_SECONDS = 30;
const MIN_DURATION_FOR_REMAINING_RULE = 60;

/** Started, not finished, and far enough in to be worth resuming. */
export function isResumable(state: SavedPlayback): boolean {
  const { positionSeconds: position, durationSeconds: duration } = state;
  if (state.completed || lastPlayedMs(state) === 0 || !Number.isFinite(position) || position < MIN_RESUME_SECONDS) {
    return false;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return true;
  }
  if (position / duration >= COMPLETED_FRACTION) {
    return false;
  }
  return !(duration >= MIN_DURATION_FOR_REMAINING_RULE && duration - position <= COMPLETED_REMAINING_SECONDS);
}

export function watchedFraction(state: SavedPlayback): number {
  const { positionSeconds: position, durationSeconds: duration } = state;
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, position / duration));
}

/** Resumable items, most recently played first. */
export function selectContinueWatching(states: readonly SavedPlayback[], limit: number): SavedPlayback[] {
  return states.filter(isResumable).sort(byLastPlayedDesc).slice(0, limit);
}

/** Everything ever played, finished or not, most recently played first. */
export function selectRecentlyWatched(states: readonly SavedPlayback[], limit: number): SavedPlayback[] {
  return states
    .filter((state) => lastPlayedMs(state) > 0)
    .sort(byLastPlayedDesc)
    .slice(0, limit);
}

function lastPlayedMs(state: SavedPlayback): number {
  const ms = state.lastPlayedAt ? Date.parse(state.lastPlayedAt) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function byLastPlayedDesc(a: SavedPlayback, b: SavedPlayback): number {
  return lastPlayedMs(b) - lastPlayedMs(a) || a.mediaId.localeCompare(b.mediaId);
}
