/**
 * Edit after download: Trim (#374), Convert to MP4 or audio only (#376). Pure decisions, mirrored by the native editor
 * (library/MediaEditor.kt), which re-checks everything before it writes a byte. Every edit makes a NEW library item;
 * the original file is never modified.
 *
 * Format rule: a track is copied as it is (transmuxed — fast, no quality loss) whenever the output can carry it;
 * only a track it cannot carry is re-encoded (H.264 video, AAC audio). AAC audio always passes through.
 */

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { formatPlaybackTime } from '@/player/format-time';

export type EditKind = 'trim' | 'mp4' | 'audio';
export type VideoPlan = EditRequest['video'];
export type AudioPlan = EditRequest['audio'];
export type TrackPlan = { video: VideoPlan; audio: AudioPlan };

export type EditSource = Pick<
  LibraryItem,
  'id' | 'title' | 'videoCodec' | 'audioCodec' | 'hasAudio' | 'container' | 'mimeType' | 'durationMs' | 'sizeBytes'
>;

/** A trim keeps at least this much. */
export const MIN_TRIM_MS = 1_000;
/** Kept free beyond the output, like the native check. */
export const EDIT_FREE_SPACE_MARGIN_BYTES = 64 * 1024 * 1024;
/** Output size against the part of the source it keeps: copied tracks about the same, re-encoded up to double. */
export const COPY_FACTOR = 1.1;
export const REENCODE_FACTOR = 2;
/** Longest title an edit gives its new item, in code points. */
export const MAX_EDIT_TITLE_LENGTH = 150;

/** Video codecs an MP4 carries as they are. */
const MP4_VIDEO = new Set(['video/avc', 'video/hevc']);
/** AAC, under the names the platform reports. */
const AAC = new Set(['audio/mp4a-latm', 'audio/aac']);

function lower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase();
}

export function isAudioOnlySource(source: Pick<EditSource, 'mimeType'>): boolean {
  return lower(source.mimeType).startsWith('audio/');
}

export function isAacAudio(codec: string | null | undefined): boolean {
  return AAC.has(lower(codec));
}

export function isMp4Video(codec: string | null | undefined): boolean {
  return MP4_VIDEO.has(lower(codec));
}

export type TrimRange = { startMs: number; endMs: number };
export type TrimCheck = { ok: true; range: TrimRange } | { ok: false; reason: 'no-duration' | 'too-short' };

/**
 * A trim range made valid: whole milliseconds, start within [0, length - 1 s], end within [start + 1 s, length]. A
 * video shorter than one second cannot be trimmed.
 */
export function clampTrimRange(range: TrimRange, durationMs: number | null | undefined): TrimCheck {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { ok: false, reason: 'no-duration' };
  }
  const length = Math.floor(durationMs);
  if (length < MIN_TRIM_MS) {
    return { ok: false, reason: 'too-short' };
  }
  const rawStart = Number.isFinite(range.startMs) ? Math.round(range.startMs) : 0;
  const rawEnd = Number.isFinite(range.endMs) ? Math.round(range.endMs) : length;
  const startMs = Math.min(Math.max(0, rawStart), length - MIN_TRIM_MS);
  const endMs = Math.min(Math.max(rawEnd, startMs + MIN_TRIM_MS), length);
  return { ok: true, range: { startMs, endMs } };
}

/** Whether a trim range keeps the whole video (nothing to trim). */
export function trimsNothing(range: TrimRange, durationMs: number): boolean {
  return range.startMs <= 0 && range.endMs >= Math.floor(durationMs);
}

/**
 * How each track goes into the output.
 * - Audio: AAC is copied, anything else re-encoded to AAC; no audio → none.
 * - Audio only: the video is dropped.
 * - MP4: H.264/H.265 copied, anything else re-encoded to H.264.
 * - Trim: copied only when the start is on a keyframe (then nothing before it is needed); an exact start in the
 *   middle of a group of frames re-encodes the video.
 */
export function trackPlan(kind: EditKind, source: Pick<EditSource, 'videoCodec' | 'audioCodec' | 'hasAudio'>, keyframeStart = false): TrackPlan {
  const audio: AudioPlan = !source.hasAudio ? 'drop' : isAacAudio(source.audioCodec) ? 'copy' : 'aac';
  if (kind === 'audio') {
    return { video: 'drop', audio };
  }
  const copyable = isMp4Video(source.videoCodec);
  if (kind === 'mp4') {
    return { video: copyable ? 'copy' : 'h264', audio };
  }
  return { video: copyable && keyframeStart ? 'copy' : 'h264', audio };
}

export type EditAvailability = 'ok' | 'already-mp4' | 'no-audio' | 'audio-source' | 'no-duration' | 'too-short';

/** Whether an edit makes sense for this item, and why not. */
export function editAvailability(kind: EditKind, source: EditSource): EditAvailability {
  if (kind === 'audio') {
    return source.hasAudio ? 'ok' : 'no-audio';
  }
  if (isAudioOnlySource(source)) {
    return 'audio-source';
  }
  if (kind === 'trim') {
    const check = clampTrimRange({ startMs: 0, endMs: source.durationMs ?? 0 }, source.durationMs);
    return check.ok ? 'ok' : check.reason;
  }
  const plan = trackPlan('mp4', source);
  return source.container === 'mp4' && plan.video === 'copy' && plan.audio !== 'aac' ? 'already-mp4' : 'ok';
}

/** "<title> (<label>)", capped by code points so Urdu and emoji stay whole. */
export function editOutputTitle(title: string, label: string): string {
  const suffix = ` (${label})`;
  const base = title.trim() || label;
  const room = Math.max(1, MAX_EDIT_TITLE_LENGTH - Array.from(suffix).length);
  const points = Array.from(base);
  return `${points.length > room ? points.slice(0, room).join('').trimEnd() : base}${suffix}`;
}

/** The output's size, estimated from the part of the source it keeps and whether the video is re-encoded. */
export function estimateEditBytes(
  source: Pick<EditSource, 'sizeBytes' | 'durationMs'>,
  plan: TrackPlan,
  range?: TrimRange | null,
): number {
  const duration = source.durationMs && source.durationMs > 0 ? source.durationMs : null;
  const fraction = range && duration ? Math.min(1, Math.max(0, (range.endMs - range.startMs) / duration)) : 1;
  const factor = plan.video === 'h264' ? REENCODE_FACTOR : COPY_FACTOR;
  return Math.round(Math.max(0, source.sizeBytes) * fraction * factor);
}

/** Whether the free space holds the output and the margin. Unknown free space is not a refusal (native checks too). */
export function hasRoomForEdit(freeBytes: number | null | undefined, neededBytes: number): boolean {
  if (typeof freeBytes !== 'number' || !Number.isFinite(freeBytes)) {
    return true;
  }
  return freeBytes >= neededBytes + EDIT_FREE_SPACE_MARGIN_BYTES;
}

/** The request the native editor receives. */
export function editRequest(
  kind: EditKind,
  source: EditSource,
  title: string,
  trim?: { range: TrimRange; keyframeStart: boolean },
): EditRequest {
  const plan = trackPlan(kind, source, trim?.keyframeStart ?? false);
  return {
    sourceId: source.id,
    kind,
    startMs: kind === 'trim' ? (trim?.range.startMs ?? 0) : null,
    endMs: kind === 'trim' ? (trim?.range.endMs ?? null) : null,
    keyframeStart: kind === 'trim' ? Boolean(trim?.keyframeStart) && plan.video === 'copy' : false,
    video: plan.video,
    audio: plan.audio,
    title,
  };
}

/** A trim position as the screen shows it: the player's own mm:ss (or h:mm:ss) plus tenths of a second. */
export function formatTrimTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return formatPlaybackTime(null);
  }
  const whole = Math.floor(ms / 1000);
  return `${formatPlaybackTime(whole)}.${Math.floor((ms % 1000) / 100)}`;
}
