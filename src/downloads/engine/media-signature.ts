/**
 * Lightweight container signature checks — no Expo/RN dependencies.
 */

import {
  classifyMp4Container,
  isActionableStandaloneMp4,
  readMp4Boxes,
  type Mp4ContainerKind,
} from './mp4-box-classify';

const HTML_MARKERS = ['<!doctype html', '<html', '<head', '{"', '{"error'];

export type MediaSignatureResult = {
  ok: boolean;
  kind: 'mp4' | 'mov' | 'avi' | 'wmv' | 'webm' | 'mkv' | 'ts' | 'mp3' | 'unknown' | 'html' | 'json';
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
  if (/^[\[{]/.test(textHead)) {
    return { ok: false, kind: 'json', reason: 'json' };
  }
  if (HTML_MARKERS.some((marker) => textHead.startsWith(marker))) {
    return { ok: false, kind: 'html', reason: 'html_payload' };
  }

  const firstBox = decodeAscii(bytes.subarray(4, 8), 4);
  if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'styp', 'sidx', 'moof'].includes(firstBox)) {
    const boxes = readMp4Boxes(bytes);
    // Container encryption evidence is an exclusion, never a decryption path.
    const protectedBoxes = boxes.some((box) => box.type === 'pssh') || boxes.some((box) => {
      if (box.type !== 'moov') return false;
      const end = Math.min(bytes.length, box.offset + box.size);
      for (let offset = box.offset + 8; offset + 8 <= end; offset += 1) {
        const type = decodeAscii(bytes.subarray(offset + 4, offset + 8), 4);
        if (!['encv', 'enca', 'pssh'].includes(type)) continue;
        const size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
        if (size >= 8 && offset + size <= box.offset + box.size) return true;
      }
      return false;
    });
    if (protectedBoxes) return { ok: false, kind: 'mp4', reason: 'drm_protected' };
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
          reason: classified.reason === 'invalid_box_size' ? 'invalid_box_size' : 'mp4_structure_unproven',
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
      kind: classified.hasFtyp && decodeAscii(bytes.subarray(8, 12), 4) !== 'qt  ' ? 'mp4' : 'mov',
      reason: null,
      mp4Kind: classified.kind,
    };
  }

  // RIFF AVI/AVIX. WAV and WebP also use RIFF and must not pass this gate.
  if (decodeAscii(bytes, 4) === 'RIFF' && decodeAscii(bytes.subarray(8, 12), 4) === 'AVI ') {
    const declaredSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8;
    if (declaredSize < 12 || inputTotalTooSmall(declaredSize, options?.resourceTotalBytes)) return { ok: false, kind: 'avi', reason: 'invalid_box_size' };
    return { ok: true, kind: 'avi', reason: null };
  }
  // ASF Header Object GUID plus a video stream type GUID. Audio-only ASF is not WMV.
  const asfHeader = [0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c];
  const asfVideo = [0xc0,0xef,0x19,0xbc,0x4d,0x5b,0xcf,0x11,0xa8,0xfd,0x00,0x80,0x5f,0x5c,0x44,0x2b];
  if (asfHeader.every((b, i) => bytes[i] === b)) {
    for (let i = 30; i + 16 <= bytes.length; i += 1) {
      if (asfVideo.every((b, j) => bytes[i + j] === b)) return { ok: true, kind: 'wmv', reason: null };
    }
    return { ok: false, kind: 'wmv', reason: 'video_stream_unproven' };
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

function inputTotalTooSmall(declaredSize: number, total?: number | null): boolean {
  return total != null && total > 0 && declaredSize > total;
}

function decodeAscii(bytes: Uint8Array, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}
