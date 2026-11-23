/**
 * P12 Create GIF (#676): the part (1–15 s), the size (320 or 480 pixels wide, never wider than the video), the frame
 * rate (5, 10 or 15 fps), the size estimate shown before anything starts, and the request `startGifExport` receives
 * (library/GifExport.kt and library/GifEncoder.kt, the app's own GIF89a encoder). Pure.
 *
 * Frames = ⌈length × fps⌉, one every 1/fps s from the start.
 * Estimated size = 33 + frames × (788 + L + ⌈L ÷ 255⌉) bytes, with L = ⌈width × height × 3 ÷ 5⌉:
 * - 33 bytes for the file (header, logical screen, loop extension, trailer);
 * - per frame 788 bytes (control extension, image descriptor, a 256-colour table, LZW code size, terminator), the LZW
 *   data L (counted at 0.6 byte a pixel, typical of video frames without dithering) and one length byte per 255.
 * The free-space check counts L at 1.5 bytes a pixel instead (12-bit codes, the most LZW writes), twice: the GIF in the
 * Gallery and its private share copy. The same maths runs in Kotlin (GifPlan), tested with the same numbers.
 */

import type { GifRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { screenshotTitle } from '@/player/edit-tools';

import { isAudioOnlySource, type EditSource } from './edit-plan';

export const GIF_MIN_LENGTH_MS = 1_000;
export const GIF_MAX_LENGTH_MS = 15_000;
/** The lengths the sheet offers (each capped by what the video has). */
export const GIF_LENGTHS_MS: readonly number[] = [2_000, 3_000, 5_000, 10_000, 15_000];
export const GIF_DEFAULT_LENGTH_MS = 3_000;
/** Width presets; each is capped at the video's own width. */
export const GIF_WIDTHS: readonly number[] = [320, 480];
export const GIF_DEFAULT_WIDTH = 320;
export const GIF_FRAME_RATES: readonly number[] = [5, 10, 15];
export const GIF_DEFAULT_FPS = 10;
/** The start's − / + step in the sheet. */
export const GIF_START_STEP_MS = 500;
/** Same as GifPlan.FILE_OVERHEAD_BYTES / FRAME_OVERHEAD_BYTES. */
export const GIF_FILE_OVERHEAD_BYTES = 33;
export const GIF_FRAME_OVERHEAD_BYTES = 788;
/** The native limits (GifRequestRecord): 16–480 px wide, 1–15 fps. */
export const GIF_MIN_WIDTH = 16;
export const GIF_MAX_WIDTH = 480;

export type GifSource = Pick<EditSource, 'id' | 'title' | 'durationMs' | 'mimeType'> &
  Partial<Pick<LibraryItem, 'width' | 'height'>>;

export type GifRange = { startMs: number; endMs: number };
export type GifSize = { width: number; height: number };

/** What the sheet chooses: where the part starts, how long it is, the width preset and the frame rate. */
export type GifChoice = { startMs: number; lengthMs: number; width: number; fps: number };

export type GifAvailability = 'ok' | 'audio-source' | 'no-duration' | 'too-short' | 'no-size';

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Whether a GIF can be made of this item, and why not. */
export function gifAvailability(source: GifSource): GifAvailability {
  if (isAudioOnlySource(source)) {
    return 'audio-source';
  }
  if (!positive(source.durationMs)) {
    return 'no-duration';
  }
  if (Math.floor(source.durationMs) < GIF_MIN_LENGTH_MS) {
    return 'too-short';
  }
  return positive(source.width) && positive(source.height) ? 'ok' : 'no-size';
}

/**
 * The part, made valid: 1–15 s long (never more than the video), inside the video; near the end the start moves back
 * so the length chosen is kept. Null for a video without a length or shorter than 1 s. Same as GifPlan.clampRange.
 */
export function gifRange(startMs: number, lengthMs: number, durationMs: number | null | undefined): GifRange | null {
  if (!positive(durationMs) || Math.floor(durationMs) < GIF_MIN_LENGTH_MS) {
    return null;
  }
  const duration = Math.floor(durationMs);
  const wanted = Number.isFinite(lengthMs) ? Math.round(lengthMs) : GIF_DEFAULT_LENGTH_MS;
  const length = Math.min(Math.min(Math.max(wanted, GIF_MIN_LENGTH_MS), GIF_MAX_LENGTH_MS), duration);
  const start = Math.min(Math.max(0, Number.isFinite(startMs) ? Math.round(startMs) : 0), duration - length);
  return { startMs: start, endMs: start + length };
}

/** The GIF's size at `width` for a video of `sourceWidth` × `sourceHeight`: never wider than the video, aspect kept. */
export function gifOutputSize(
  sourceWidth: number | null | undefined,
  sourceHeight: number | null | undefined,
  width: number,
): GifSize | null {
  if (!positive(sourceWidth) || !positive(sourceHeight) || !positive(width)) {
    return null;
  }
  const w = Math.min(Math.round(width), Math.round(sourceWidth));
  return { width: w, height: Math.max(1, Math.round((sourceHeight * w) / sourceWidth)) };
}

/**
 * The lengths the sheet offers for a video of `durationMs`: the ones that fit in it; a video shorter than the shortest
 * gets its own length (at least 1 s). Empty when no GIF can be made.
 */
export function gifLengthOptions(durationMs: number | null | undefined): number[] {
  if (!positive(durationMs) || Math.floor(durationMs) < GIF_MIN_LENGTH_MS) {
    return [];
  }
  const fitting = GIF_LENGTHS_MS.filter((length) => length <= durationMs);
  return fitting.length > 0 ? fitting : [Math.floor(durationMs / 100) * 100];
}

export type GifWidthOption = { preset: number; size: GifSize };

/** The width choices: each preset capped at the video's width; presets that come out the same are one choice. */
export function gifWidthOptions(sourceWidth: number | null | undefined, sourceHeight: number | null | undefined): GifWidthOption[] {
  const options: GifWidthOption[] = [];
  for (const preset of GIF_WIDTHS) {
    const size = gifOutputSize(sourceWidth, sourceHeight, preset);
    if (size && !options.some((option) => option.size.width === size.width)) {
      options.push({ preset, size });
    }
  }
  return options;
}

export function gifFrameCount(lengthMs: number, fps: number): number {
  if (!positive(lengthMs) || !positive(fps)) {
    return 0;
  }
  return Math.floor((Math.round(lengthMs) * Math.round(fps) + 999) / 1000);
}

function gifBytes(frames: number, width: number, height: number, numerator: number, denominator: number): number {
  if (!positive(frames) || !positive(width) || !positive(height)) {
    return 0;
  }
  const lzw = Math.ceil((width * height * numerator) / denominator);
  return GIF_FILE_OVERHEAD_BYTES + frames * (GIF_FRAME_OVERHEAD_BYTES + lzw + Math.ceil(lzw / 255));
}

/** About how big the GIF is (the sheet shows it before it starts). */
export function gifEstimateBytes(frames: number, width: number, height: number): number {
  return gifBytes(frames, width, height, 3, 5);
}

/** The most the GIF can take. */
export function gifMaxBytes(frames: number, width: number, height: number): number {
  return gifBytes(frames, width, height, 3, 2);
}

/** The free space the export needs (the native check's own number): the Gallery GIF and its share copy at most. */
export function gifSpaceNeededBytes(frames: number, width: number, height: number): number {
  return 2 * gifMaxBytes(frames, width, height);
}

export type GifPreview = { range: GifRange; size: GifSize; frames: number; estimateBytes: number; spaceBytes: number };

/** What the sheet shows for a choice: the part, the size, the frames and the estimate. Null when it can't be made. */
export function gifPreview(source: GifSource, choice: GifChoice): GifPreview | null {
  if (gifAvailability(source) !== 'ok' || !GIF_FRAME_RATES.includes(choice.fps)) {
    return null;
  }
  const range = gifRange(choice.startMs, choice.lengthMs, source.durationMs);
  const size = gifOutputSize(source.width, source.height, choice.width);
  if (!range || !size || size.width < GIF_MIN_WIDTH || size.width > GIF_MAX_WIDTH) {
    return null;
  }
  const frames = gifFrameCount(range.endMs - range.startMs, choice.fps);
  return {
    range,
    size,
    frames,
    estimateBytes: gifEstimateBytes(frames, size.width, size.height),
    spaceBytes: gifSpaceNeededBytes(frames, size.width, size.height),
  };
}

/** The GIF's Gallery name: "<video title> 1m23.4s" (its start), as a screenshot is named. */
export function gifTitle(videoTitle: string | null | undefined, startMs: number, fallback: string): string {
  return screenshotTitle(videoTitle, startMs / 1000, fallback);
}

/** The request `startGifExport` receives; null when the choice can't be made. */
export function gifRequest(source: GifSource, choice: GifChoice, title: string): GifRequest | null {
  const preview = gifPreview(source, choice);
  if (!preview) {
    return null;
  }
  return {
    sourceId: source.id,
    startMs: preview.range.startMs,
    endMs: preview.range.endMs,
    width: preview.size.width,
    fps: choice.fps,
    title,
  };
}
