/**
 * P6 #733 Next Episode Prompt: when the "Next: …" card shows and what its countdown says. Pure (unit-tested).
 *
 * Checklist #733 gives no timing ("to move quickly through episodes"), so VidoraX's is: the card shows in the last
 * `NEXT_EPISODE_PROMPT_SECONDS` of a video at least `NEXT_EPISODE_MIN_DURATION_SECONDS` long, counting down the
 * seconds left. At 0 the video ends and the end decision plays the next one. It shows only when that decision is
 * going to play the next video anyway (Auto Play Next or Repeat all; never with Repeat one, an A-B loop or Stop) and
 * the next video looks like the next episode (`episode-name.ts`). Cancel hides it for this video, and the video then
 * stops at its end.
 */

import type { EndOfPlaybackOutcome } from './end-of-playback';
import { looksLikeNextEpisode } from './episode-name';

export const NEXT_EPISODE_PROMPT_SECONDS = 10;
export const NEXT_EPISODE_MIN_DURATION_SECONDS = 30;

export type NextEpisodePromptInput = {
  enabled: boolean;
  /** What the end of this video will do now (`decideEndOfPlayback` without the cancel). */
  upcoming: EndOfPlaybackOutcome;
  currentTitle: string | null;
  nextTitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  /** The user cancelled the card for this video. */
  cancelled: boolean;
  /** The video can take commands (loaded, no error). */
  ready: boolean;
};

export type NextEpisodePromptState =
  | { visible: false }
  | { visible: true; nextId: string; nextTitle: string; secondsLeft: number };

export function nextEpisodePromptState(input: NextEpisodePromptInput): NextEpisodePromptState {
  const { upcoming, durationSeconds } = input;
  if (
    !input.enabled ||
    input.cancelled ||
    !input.ready ||
    upcoming.kind !== 'next' ||
    !input.nextTitle ||
    durationSeconds == null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < NEXT_EPISODE_MIN_DURATION_SECONDS ||
    !looksLikeNextEpisode(input.currentTitle, input.nextTitle)
  ) {
    return { visible: false };
  }
  const left = durationSeconds - input.positionSeconds;
  if (!Number.isFinite(left) || left <= 0 || left > NEXT_EPISODE_PROMPT_SECONDS) {
    return { visible: false };
  }
  return { visible: true, nextId: upcoming.mediaId, nextTitle: input.nextTitle, secondsLeft: Math.ceil(left) };
}
