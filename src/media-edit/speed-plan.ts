/**
 * P12 Change speed (#684): a NEW item that plays faster or slower, of the whole video or a part (library/SpeedPlan.kt:
 * Media3 Transformer's own speed change, `EditedMediaItem.Builder.setSpeed`, in 1.9.0). Pure: the speed choices
 * (0.25× to 4×, not 1×), the part (at least 1 s, inside the video; the whole video when it covers all of it), the
 * copy's length (the part ÷ the speed), the space it needs, and the request `startEdit` receives (`kind: 'speed'`).
 *
 * The sound follows the speed as on a tape (Media3 1.9.0 changes its pitch with it). Space = the part's share of the
 * file × 2 ÷ the speed (a slower copy is longer), as the native check counts it.
 */

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { clampTrimRange, isAudioOnlySource, REENCODE_FACTOR, type TrimRange } from './edit-plan';

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
/** The sheet's choices, slowest first. */
export const SPEED_CHOICES: readonly number[] = [0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4];
export const SPEED_DEFAULT = 2;

export type SpeedSource = Pick<LibraryItem, 'id' | 'title' | 'mimeType' | 'durationMs' | 'sizeBytes' | 'hasAudio'>;

/** 0.25× to 4×, and not 1× (that would be the same video). */
export function isValidExportSpeed(speed: number): boolean {
  return Number.isFinite(speed) && speed >= SPEED_MIN && speed <= SPEED_MAX && Math.abs(speed - 1) >= 0.001;
}

export type SpeedRangeCheck = { ok: true; range: TrimRange | null } | { ok: false; reason: 'no-duration' | 'too-short' };

/**
 * The part, made valid for a video of `durationMs` (`null` asks for the whole video): like a trim, at least 1 s inside
 * the video. A part that covers the whole video is the whole video (`range: null`). Same as SpeedPlan.range.
 */
export function speedRange(part: TrimRange | null, durationMs: number | null | undefined): SpeedRangeCheck {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, reason: 'no-duration' };
  }
  if (!part) {
    return { ok: true, range: null };
  }
  const check = clampTrimRange(part, durationMs);
  if (!check.ok) {
    return check;
  }
  const whole = check.range.startMs <= 0 && check.range.endMs >= Math.floor(durationMs);
  return { ok: true, range: whole ? null : check.range };
}

/** How long the copy is: the part's length ÷ the speed (ms). */
export function speedOutputMs(keptMs: number, speed: number): number {
  if (!Number.isFinite(keptMs) || keptMs <= 0 || !Number.isFinite(speed) || speed <= 0) {
    return 0;
  }
  return Math.round(keptMs / speed);
}

/** The part's length (ms): the range, or the whole video. */
export function speedKeptMs(range: TrimRange | null, durationMs: number): number {
  return range ? range.endMs - range.startMs : Math.floor(durationMs);
}

/** The free space the copy needs (beyond the margin). Same as SpeedPlan.estimateBytes. */
export function speedEstimateBytes(
  source: Pick<SpeedSource, 'sizeBytes' | 'durationMs'>,
  range: TrimRange | null,
  speed: number,
): number {
  const duration = typeof source.durationMs === 'number' && source.durationMs > 0 ? source.durationMs : 0;
  const fraction = range && duration > 0 ? (range.endMs - range.startMs) / duration : 1;
  return Math.floor((Math.max(0, source.sizeBytes) * fraction * REENCODE_FACTOR) / speed);
}

export type SpeedAvailability = 'ok' | 'audio-source' | 'no-duration' | 'too-short' | 'bad-speed';

/** Whether this speed change makes sense for this item, and why not. */
export function speedAvailability(source: SpeedSource, speed: number, part: TrimRange | null): SpeedAvailability {
  if (isAudioOnlySource(source)) {
    return 'audio-source';
  }
  if (!isValidExportSpeed(speed)) {
    return 'bad-speed';
  }
  const check = speedRange(part, source.durationMs);
  return check.ok ? 'ok' : check.reason;
}

/** The request `startEdit` receives; the part already checked with [speedRange] (null: the whole video). */
export function speedRequest(source: SpeedSource, speed: number, range: TrimRange | null, title: string): EditRequest {
  return {
    sourceId: source.id,
    kind: 'speed',
    startMs: range ? range.startMs : null,
    endMs: range ? range.endMs : null,
    keyframeStart: false,
    video: 'h264',
    audio: source.hasAudio ? 'aac' : 'drop',
    title,
    speed,
  };
}

/** "0.25×", "2×", "1.5×": a speed as the sheet and the new item's title show it (not translated). */
export function formatExportSpeed(speed: number): string {
  if (!Number.isFinite(speed) || speed <= 0) {
    return '1×';
  }
  return `${Number(speed.toFixed(2))}×`;
}
