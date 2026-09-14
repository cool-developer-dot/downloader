/**
 * Lightweight container signature checks — no Expo/RN dependencies.
 */

import {
  classifyMp4Container,
  isActionableStandaloneMp4,
  type Mp4ContainerKind,
} from './mp4-box-classify';

const HTML_MARKERS = ['<!doctype html', '<html', '<head', '{"', '{"error'];

export type MediaSignatureResult = {
  ok: boolean;
  kind: 'mp4' | 'webm' | 'mkv' | 'ts' | 'mp3' | 'unknown' | 'html' | 'json';
  reason: string | null;
  /** Present when ISO BMFF structure was classified. */
  mp4Kind?: Mp4ContainerKind;
};

export const MIN_VALID_MEDIA_BYTES = 16_384;

export function sniffMediaSignature(
  bytes: Uint8Array,
  options?: {
    resourceTotalBytes?: number | null;
    coversEntireResource?: boolean;
    /** When true, init/fragment structures are not ok. */
    requireStandaloneMp4?: boolean;
  },
): MediaSignatureResult {
  if (bytes.length < 12) {
    return { ok: false, kind: 'unknown', reason: 'too_small' };
  }

  const textHead = decodeAscii(bytes, Math.min(bytes.length, 256)).trimStart().toLowerCase();
  if (textHead.startsWith('{"') || textHead.startsWith('{"error')) {
    return { ok: false, kind: 'json', reason: 'json' };
  }
  if (HTML_MARKERS.some((marker) => textHead.startsWith(marker))) {
    return { ok: false, kind: 'html', reason: 'html_payload' };
  }

  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const classified = classifyMp4Container({
      bytes,
      resourceTotalBytes: options?.resourceTotalBytes,
      coversEntireResource: options?.coversEntireResource,
    });
    if (options?.requireStandaloneMp4) {
      if (classified.kind === 'INIT_SEGMENT') {
        return {
          ok: false,
          kind: 'mp4',
          reason: 'init_segment',
          mp4Kind: classified.kind,
        };
      }
      if (classified.kind === 'MEDIA_FRAGMENT') {
        return {
          ok: false,
          kind: 'mp4',
          reason: 'media_fragment',
          mp4Kind: classified.kind,
        };
      }
      if (classified.kind === 'UNKNOWN') {
        return {
          ok: false,
          kind: 'mp4',
          reason: 'mp4_structure_unproven',
          mp4Kind: classified.kind,
        };
      }
      if (!isActionableStandaloneMp4(classified.kind)) {
        return {
          ok: false,
          kind: 'mp4',
          reason: classified.reason,
          mp4Kind: classified.kind,
        };
      }
    }
    return {
      ok: true,
      kind: 'mp4',
      reason: null,
      mp4Kind: classified.kind,
    };
  }

  // Media fragment may start with moof (no ftyp).
  if (
    bytes[4] === 0x6d &&
    bytes[5] === 0x6f &&
    bytes[6] === 0x6f &&
    bytes[7] === 0x66
  ) {
    return {
      ok: false,
      kind: 'mp4',
      reason: 'media_fragment',
      mp4Kind: 'MEDIA_FRAGMENT',
    };
  }

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { ok: true, kind: 'webm', reason: null };
  }

  if (bytes[0] === 0x47) {
    return { ok: true, kind: 'ts', reason: null };
  }

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  ) {
    return { ok: true, kind: 'mp3', reason: null };
  }

  return { ok: false, kind: 'unknown', reason: 'unrecognized_signature' };
}

function decodeAscii(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}
