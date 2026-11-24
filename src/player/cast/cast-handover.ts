/**
 * P13 #667: handing the video over between the phone and the TV. Pure, so it is unit tested.
 *
 * - **Phone → TV:** the TV starts where the phone is. A video that has finished (or is in its last second) starts on
 *   the TV from the beginning, as Replay would.
 * - **TV → phone:** when casting stops, the phone continues from the TV's position. Stopped by the user: it plays on.
 *   The connection dropped or the TV ended the session: it waits, paused, at that position. A video the TV played to
 *   the end is left as it is (seeking to the end would start the end-of-video actions: Repeat, Auto Play Next).
 */

import type { CastDisconnectReason } from '@modules/vidorax-media/src/VidoraCast.types';

/** The last second counts as finished: starting there would end at once. */
export const CAST_END_MARGIN_SECONDS = 1;

export function castStartPositionMs(input: {
  positionSeconds: number;
  durationSeconds: number | null;
  isCompleted: boolean;
}): number {
  const position = Number.isFinite(input.positionSeconds) ? Math.max(0, input.positionSeconds) : 0;
  const duration = input.durationSeconds != null && Number.isFinite(input.durationSeconds) ? input.durationSeconds : null;
  if (input.isCompleted || (duration != null && duration > 0 && position >= duration - CAST_END_MARGIN_SECONDS)) {
    return 0;
  }
  return Math.round(position * 1000);
}

export type PhoneResume = {
  /** Where the phone seeks to; null leaves the phone where it is. */
  seekSeconds: number | null;
  play: boolean;
};

export function phoneResumeAfterCast(input: {
  reason: CastDisconnectReason;
  tvPositionMs: number | null;
  finished: boolean;
  durationSeconds: number | null;
  /** The TV had this video loaded (a failed connect never did). */
  wasCasting: boolean;
}): PhoneResume {
  if (!input.wasCasting || input.reason === 'failed' || input.finished) {
    return { seekSeconds: null, play: false };
  }
  const play = input.reason === 'stopped';
  if (input.tvPositionMs == null || !Number.isFinite(input.tvPositionMs)) {
    return { seekSeconds: null, play };
  }
  let seconds = Math.max(0, input.tvPositionMs / 1000);
  const duration = input.durationSeconds;
  if (duration != null && Number.isFinite(duration) && duration > 0) {
    seconds = Math.min(seconds, Math.max(0, duration - CAST_END_MARGIN_SECONDS));
  }
  return { seekSeconds: Math.round(seconds * 1000) / 1000, play };
}
