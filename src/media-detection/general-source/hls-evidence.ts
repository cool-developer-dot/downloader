/**
 * Phase 5B — HLS evidence helpers for general-web source verification.
 * Bounded parse only — never downloads segments; never claims audio without evidence.
 */

import type { HlsParseResult, HlsVariantInfo } from '../parsers/hls.parser';
import { resolveQualityLabelFromEvidence } from '../social-source/quality-evidence';
import type { GeneralAudioState } from './types';

/**
 * Infer audio state from HLS CODECS / AUDIO group evidence only.
 * Never assume HLS always has audio.
 */
export function resolveHlsAudioState(input: {
  codecs?: string | null;
  audioGroup?: string | null;
  isEncrypted?: boolean;
}): GeneralAudioState {
  if (input.isEncrypted) {
    return 'UNKNOWN';
  }
  const codecs = input.codecs?.trim() ?? '';
  if (!codecs) {
    // Separate AUDIO group exists but relationship unproven without muxer → UNKNOWN.
    return 'UNKNOWN';
  }
  const hasAudio = /(?:mp4a|opus|ac-3|ec-3|mp3|flac)/i.test(codecs);
  const hasVideo = /(?:avc1|avc3|hev1|hvc1|vp09|vp9|av01|dvh1|dvhe)/i.test(codecs);
  if (hasVideo && hasAudio) {
    return 'INCLUDED';
  }
  if (hasVideo && !hasAudio) {
    // AUDIO group may supply audio — without proven mux path, treat as VIDEO_ONLY.
    return input.audioGroup ? 'VIDEO_ONLY' : 'VIDEO_ONLY';
  }
  if (!hasVideo && hasAudio) {
    return 'AUDIO_ONLY';
  }
  return 'UNKNOWN';
}

export function isHlsDrmOrUnsupportedEncryption(parsed: HlsParseResult): boolean {
  return parsed.isEncrypted === true;
}

export function qualityLabelFromHlsVariant(variant: HlsVariantInfo): string | null {
  return resolveQualityLabelFromEvidence({
    width: variant.width,
    height: variant.height,
  });
}

/**
 * Prefer Content-Range total over probe Content-Length slice.
 * Content-Range: bytes 0-0/N → N
 * Content-Length: 1 on a Range probe → not a total size
 */
export function resolveSizeFromHttpHeaders(input: {
  contentLength: number | null | undefined;
  contentRange: string | null | undefined;
}): number | null {
  const range = input.contentRange?.trim();
  if (range) {
    const match = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(range);
    const raw = match?.[1];
    if (raw && raw !== '*') {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 4096) {
        return Math.trunc(n);
      }
      if (Number.isFinite(n) && n > 1 && n <= 4096) {
        // Tiny totals are not credible media sizes.
        return null;
      }
    }
  }
  const len = input.contentLength;
  if (typeof len === 'number' && Number.isFinite(len) && len > 4096) {
    return Math.floor(len);
  }
  return null;
}

/** HLS totals are typically unknown without enumerating segments — omit. */
export function hlsSizeBytesAlwaysOmitted(): null {
  return null;
}

export function looksLikeHlsCandidate(input: {
  url: string;
  mimeType?: string | null;
  streamType?: string | null;
  container?: string | null;
}): boolean {
  const lower = input.url.toLowerCase();
  if (lower.includes('.m3u8')) {
    return true;
  }
  const mime = input.mimeType?.toLowerCase() ?? '';
  if (mime.includes('mpegurl')) {
    return true;
  }
  if (input.streamType === 'HLS' || input.container === 'hls') {
    return true;
  }
  try {
    const path = new URL(input.url).pathname.toLowerCase();
    return /(?:^|\/)(?:hls|playlist)(?:[/._-]|$)/i.test(path);
  } catch {
    return false;
  }
}
