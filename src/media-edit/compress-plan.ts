/**
 * P10 Compress video (#680): three presets, the output's estimated size, and the request the native editor receives
 * (`kind: 'compress'`, library/MediaEditor.kt with library/CompressPlan.kt). Pure.
 *
 * The video is re-encoded to H.264 at the preset's bitrate and scaled down (never up) so its short side is at most the
 * preset's; the sound is copied when it is AAC, otherwise re-encoded to AAC. The size estimate is the maths the native
 * side uses too: (video bitrate + 128 kbit/s for the sound) × length ÷ 8 × 1.02 for the MP4 container. A preset that
 * would not save at least 10 % of the original's size is not offered ("no-gain").
 */

import type { EditRequest, LibraryItem } from '@modules/vidorax-media/src/VidoraMedia.types';

import { editRequest, isAudioOnlySource, type EditSource } from './edit-plan';

export type CompressPreset = 'high' | 'medium' | 'small';

/** In the order the sheet lists them. */
export const COMPRESS_PRESETS: readonly CompressPreset[] = ['high', 'medium', 'small'];

export type CompressTarget = {
  /** H.264 target, bits per second. */
  videoBitrate: number;
  /** The output's short side at most (pixels): 1080p, 720p, 480p. */
  maxShortSide: number;
};

export const COMPRESS_TARGETS: Readonly<Record<CompressPreset, CompressTarget>> = {
  high: { videoBitrate: 4_000_000, maxShortSide: 1080 },
  medium: { videoBitrate: 2_000_000, maxShortSide: 720 },
  small: { videoBitrate: 1_000_000, maxShortSide: 480 },
};

/** What the estimate counts for the sound (AAC, copied or re-encoded). Same as CompressPlan.AUDIO_ESTIMATE_BITRATE. */
export const COMPRESS_AUDIO_ESTIMATE_BITRATE = 128_000;
/** The MP4 container's own bytes on top of the tracks. Same as CompressPlan.CONTAINER_OVERHEAD. */
export const COMPRESS_CONTAINER_OVERHEAD = 1.02;
/** A preset is offered only when its output is at most this share of the original's size. */
export const COMPRESS_MAX_OUTPUT_RATIO = 0.9;

export type CompressSource = Pick<EditSource, 'id' | 'durationMs' | 'sizeBytes' | 'hasAudio' | 'mimeType'> &
  Partial<Pick<LibraryItem, 'width' | 'height'>>;

function validLength(durationMs: number | null | undefined): durationMs is number {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0;
}

/**
 * About how many bytes the output has: the bitrates over the length, plus the container. 0 for an unknown length. The
 * same operations in the same order as CompressPlan.estimateBytes, so both sides round alike.
 */
export function compressEstimateBytes(durationMs: number | null | undefined, target: CompressTarget, hasAudio: boolean): number {
  if (!validLength(durationMs)) {
    return 0;
  }
  const bitsPerSecond = target.videoBitrate + (hasAudio ? COMPRESS_AUDIO_ESTIMATE_BITRATE : 0);
  return Math.ceil(((bitsPerSecond * (durationMs / 1_000)) / 8) * COMPRESS_CONTAINER_OVERHEAD);
}

/** The short side the output will have: the source's, or the preset's when the source is bigger. Null when unknown. */
export function compressOutputShortSide(
  width: number | null | undefined,
  height: number | null | undefined,
  maxShortSide: number,
): number | null {
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) {
    return null;
  }
  return Math.min(Math.min(width, height), maxShortSide);
}

export type CompressAvailability = 'ok' | 'no-gain' | 'no-duration' | 'audio-source';

/** Whether this preset makes sense for this item, and why not. */
export function compressAvailability(source: CompressSource, preset: CompressPreset): CompressAvailability {
  if (isAudioOnlySource(source)) {
    return 'audio-source';
  }
  if (!validLength(source.durationMs)) {
    return 'no-duration';
  }
  const estimate = compressEstimateBytes(source.durationMs, COMPRESS_TARGETS[preset], source.hasAudio);
  return estimate <= Math.max(0, source.sizeBytes) * COMPRESS_MAX_OUTPUT_RATIO ? 'ok' : 'no-gain';
}

export type CompressOption = {
  preset: CompressPreset;
  target: CompressTarget;
  availability: CompressAvailability;
  estimateBytes: number;
  /** The output's short side (720 for "720p"); null when the video's size is unknown. */
  shortSide: number | null;
};

/** The sheet's three rows. */
export function compressOptions(source: CompressSource): CompressOption[] {
  return COMPRESS_PRESETS.map((preset) => {
    const target = COMPRESS_TARGETS[preset];
    return {
      preset,
      target,
      availability: compressAvailability(source, preset),
      estimateBytes: compressEstimateBytes(source.durationMs, target, source.hasAudio),
      shortSide: compressOutputShortSide(source.width, source.height, target.maxShortSide),
    };
  });
}

/** "720p": the short side the way video sizes are named (not translated). Null when unknown. */
export function compressResolutionLabel(shortSide: number | null | undefined): string | null {
  return typeof shortSide === 'number' && Number.isFinite(shortSide) && shortSide > 0 ? `${Math.round(shortSide)}p` : null;
}

/** The request the native editor receives: a whole-video edit, the video re-encoded, the preset's target. */
export function compressRequest(source: EditSource, preset: CompressPreset, title: string): EditRequest {
  const target = COMPRESS_TARGETS[preset];
  return {
    ...editRequest('compress', source, title),
    videoBitrate: target.videoBitrate,
    maxShortSide: target.maxShortSide,
  };
}
