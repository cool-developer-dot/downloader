/**
 * P12 Merge videos (#682): two or more library videos joined one after another into a NEW item (library/MergePlan.kt:
 * one Media3 Transformer sequence). Pure: the list (order, up / down, add, remove), when a merge can run, the output's
 * size and how each video fits in it, and the request `startEdit` receives (`kind: 'merge'`).
 *
 * - The list starts with the video playing; it can move but not leave (the merge is started from it).
 * - Each video is in the list once; at most 10.
 * - The output has the first video's size (rounded down to even numbers). Every other video is fitted inside it with
 *   its aspect ratio kept, black bars filling the rest ([mergeFitInside], what Presentation.LAYOUT_SCALE_TO_FIT draws).
 * - A clip with a higher frame rate than the first video is dropped to the first one's rate; a slower one keeps its
 *   frames. The sound: when any video has sound the output has a sound track (silent for videos without); otherwise
 *   none.
 * - Space: the videos' sizes × 2 (any re-encode, as the native check counts it).
 */

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { isAudioOnlySource, REENCODE_FACTOR } from './edit-plan';

export const MERGE_MIN_VIDEOS = 2;
export const MERGE_MAX_VIDEOS = 10;

export type MergeSource = Pick<
  LibraryItem,
  'id' | 'title' | 'mimeType' | 'durationMs' | 'sizeBytes' | 'hasAudio' | 'width' | 'height'
>;

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** A video the picker lists: a library video (not audio) with a length. */
export function isMergeCandidate(item: Pick<LibraryItem, 'mimeType' | 'durationMs'>): boolean {
  return !isAudioOnlySource(item) && positive(item.durationMs);
}

/** The list with the video at `index` one place earlier (unchanged at the top or out of range). */
export function mergeMoveUp(ids: readonly string[], index: number): string[] {
  if (!Number.isInteger(index) || index <= 0 || index >= ids.length) {
    return [...ids];
  }
  const next = [...ids];
  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
  return next;
}

/** The list with the video at `index` one place later (unchanged at the bottom or out of range). */
export function mergeMoveDown(ids: readonly string[], index: number): string[] {
  if (!Number.isInteger(index) || index < 0 || index >= ids.length - 1) {
    return [...ids];
  }
  return mergeMoveUp(ids, index + 1);
}

/** Adds a video at the end. A video already in the list, or a full list, leaves it unchanged (each video once). */
export function mergeAdd(ids: readonly string[], id: string): string[] {
  if (!id || ids.includes(id) || ids.length >= MERGE_MAX_VIDEOS) {
    return [...ids];
  }
  return [...ids, id];
}

/** Removes a video, except `keepId` (the video the merge was started from). */
export function mergeRemove(ids: readonly string[], id: string, keepId: string): string[] {
  return id === keepId ? [...ids] : ids.filter((entry) => entry !== id);
}

/** The picker's tap: adds a video not in the list, removes one that is (never `keepId`). */
export function mergeToggle(ids: readonly string[], id: string, keepId: string): string[] {
  return ids.includes(id) ? mergeRemove(ids, id, keepId) : mergeAdd(ids, id);
}

export type MergeAvailability = 'ok' | 'too-few' | 'too-many' | 'duplicate' | 'audio-source' | 'no-duration' | 'no-size';

/** Whether these videos, in this order, can be merged, and why not. */
export function mergeAvailability(sources: readonly MergeSource[]): MergeAvailability {
  if (sources.length < MERGE_MIN_VIDEOS) {
    return 'too-few';
  }
  if (sources.length > MERGE_MAX_VIDEOS) {
    return 'too-many';
  }
  if (new Set(sources.map((source) => source.id)).size !== sources.length) {
    return 'duplicate';
  }
  if (sources.some((source) => isAudioOnlySource(source))) {
    return 'audio-source';
  }
  if (sources.some((source) => !positive(source.durationMs))) {
    return 'no-duration';
  }
  return mergeOutputSize(sources[0]!) ? 'ok' : 'no-size';
}

export type MergeSize = { width: number; height: number };

/** The output's size: the first video's, rounded down to even numbers (at least 2). Null when it is unknown. */
export function mergeOutputSize(first: Pick<MergeSource, 'width' | 'height'>): MergeSize | null {
  if (!positive(first.width) || !positive(first.height)) {
    return null;
  }
  const even = (value: number) => Math.max(2, Math.floor(value) - (Math.floor(value) % 2));
  return { width: even(first.width), height: even(first.height) };
}

/**
 * Where a `width` × `height` picture ends up inside `boxWidth` × `boxHeight`: scaled to fit with its aspect kept (the
 * rest is black bars). Same as MergePlan.fitInside.
 */
export function mergeFitInside(boxWidth: number, boxHeight: number, width: number, height: number): MergeSize | null {
  if (!positive(boxWidth) || !positive(boxHeight) || !positive(width) || !positive(height)) {
    return null;
  }
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return {
    width: Math.min(boxWidth, Math.max(1, Math.round(width * scale))),
    height: Math.min(boxHeight, Math.max(1, Math.round(height * scale))),
  };
}

/** Whether a video's picture fills the output exactly (no bars). */
export function mergeFillsFrame(output: MergeSize, source: Pick<MergeSource, 'width' | 'height'>): boolean {
  const fitted = positive(source.width) && positive(source.height) ? mergeFitInside(output.width, output.height, source.width, source.height) : null;
  return fitted != null && fitted.width === output.width && fitted.height === output.height;
}

export function mergeHasAudio(sources: readonly Pick<MergeSource, 'hasAudio'>[]): boolean {
  return sources.some((source) => source.hasAudio);
}

/** The merged video's length: all the videos together. */
export function mergeTotalMs(sources: readonly Pick<MergeSource, 'durationMs'>[]): number {
  return sources.reduce((total, source) => total + (positive(source.durationMs) ? source.durationMs : 0), 0);
}

/** The free space the merge needs (beyond the margin): every video re-encoded. Same as MergePlan.estimateBytes. */
export function mergeEstimateBytes(sources: readonly Pick<MergeSource, 'sizeBytes'>[]): number {
  const total = sources.reduce((sum, source) => sum + Math.max(0, source.sizeBytes), 0);
  return Math.floor(total * REENCODE_FACTOR);
}

/** The request `startEdit` receives: the videos in order, started from `startedFromId` (one of them). */
export function mergeRequest(startedFromId: string, sources: readonly MergeSource[], title: string): EditRequest {
  return {
    sourceId: startedFromId,
    kind: 'merge',
    startMs: null,
    endMs: null,
    keyframeStart: false,
    video: 'h264',
    audio: mergeHasAudio(sources) ? 'aac' : 'drop',
    title,
    sourceIds: sources.map((source) => source.id),
  };
}
