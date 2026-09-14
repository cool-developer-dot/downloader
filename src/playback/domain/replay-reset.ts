import { PLAYBACK_REPLAY_RESET_MAX_SECONDS } from '../constants';

/**
 * Sticky completed → unfinished only on intentional replay:
 * playback has started and position is near the beginning.
 */
export function shouldResetCompletedOnReplay(input: {
  completed: boolean;
  playbackStarted: boolean;
  positionSeconds: number;
  maxSeconds?: number;
}): boolean {
  if (!input.completed || !input.playbackStarted) {
    return false;
  }
  const max = input.maxSeconds ?? PLAYBACK_REPLAY_RESET_MAX_SECONDS;
  return (
    Number.isFinite(input.positionSeconds) &&
    input.positionSeconds >= 0 &&
    input.positionSeconds < max
  );
}
