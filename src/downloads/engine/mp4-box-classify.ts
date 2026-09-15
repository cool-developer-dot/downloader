/**
 * Bounded ISO BMFF (MP4/fMP4) box classification.
 * Classification only — not a full parser or playback engine.
 *
 * ftyp alone is NOT proof of a complete standalone video.
 */

export type Mp4ContainerKind =
  | 'PROGRESSIVE_OR_COMPLETE'
  | 'FRAGMENTED_COMPLETE'
  | 'INIT_SEGMENT'
  | 'MEDIA_FRAGMENT'
  | 'UNKNOWN';

export type Mp4BoxSummary = {
  type: string;
  size: number;
  offset: number;
};

export type Mp4ClassifyInput = {
  bytes: Uint8Array;
  /** Full resource size when known (Content-Length / Content-Range total). */
  resourceTotalBytes?: number | null;
  /** True when `bytes` covers the entire resource. */
  coversEntireResource?: boolean;
};

export type Mp4ClassifyResult = {
  kind: Mp4ContainerKind;
  hasFtyp: boolean;
  hasMoov: boolean;
  hasMvex: boolean;
  hasMoof: boolean;
  hasMdat: boolean;
  firstBoxType: string | null;
  boxesScanned: number;
  reason: string;
};

/** Init-only resources on Instagram/TikTok CDNs are commonly well under 1 MiB. */
export const INIT_SEGMENT_SIZE_HINT_MAX = 768 * 1024;

/** Below this, treat as non-credible full video even if structured. */
export const MIN_STANDALONE_MEDIA_HINT_BYTES = 64 * 1024;

const MAX_BOXES = 64;

export function readMp4Boxes(
  bytes: Uint8Array,
  maxBoxes: number = MAX_BOXES,
): Mp4BoxSummary[] {
  const boxes: Mp4BoxSummary[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.length && boxes.length < maxBoxes) {
    const size32 = readU32(bytes, offset);
    const type = decodeType(bytes, offset + 4);
    if (!type) {
      break;
    }

    let boxSize = size32;
    let header = 8;
    if (size32 === 1) {
      if (offset + 16 > bytes.length) {
        break;
      }
      boxSize = readU64(bytes, offset + 8);
      header = 16;
    } else if (size32 === 0) {
      boxSize = bytes.length - offset;
    }

    if (!Number.isFinite(boxSize) || boxSize < header) {
      break;
    }

    boxes.push({ type, size: boxSize, offset });
    // Prevent infinite loops on corrupt sizes.
    const next = offset + Math.max(header, Math.min(boxSize, bytes.length - offset));
    if (next <= offset) {
      break;
    }
    offset = next;
    if (size32 === 0) {
      break;
    }
  }
  return boxes;
}

/**
 * Classify MP4/fMP4 structure from a bounded byte window.
 *
 * Rules (conservative for Download Video):
 * - First box moof / moof without moov → MEDIA_FRAGMENT
 * - ftyp+moov, no mdat, small/known-complete resource → INIT_SEGMENT
 * - ftyp + mdat (and usually moov) → PROGRESSIVE_OR_COMPLETE
 * - ftyp + moof + mdat → FRAGMENTED_COMPLETE (valid standalone fMP4)
 * - Do NOT reject merely because moof exists
 */
export function classifyMp4Container(input: Mp4ClassifyInput): Mp4ClassifyResult {
  const bytes = input.bytes;
  const empty: Mp4ClassifyResult = {
    kind: 'UNKNOWN',
    hasFtyp: false,
    hasMoov: false,
    hasMvex: false,
    hasMoof: false,
    hasMdat: false,
    firstBoxType: null,
    boxesScanned: 0,
    reason: 'too_small',
  };

  if (bytes.length < 12) {
    return empty;
  }

  // Quick ISO brand check — not sufficient alone.
  const hasFtypAt4 =
    bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;

  const boxes = readMp4Boxes(bytes);
  const types = new Set(boxes.map((b) => b.type));
  const firstBoxType = boxes[0]?.type ?? null;
  const hasFtyp = types.has('ftyp') || hasFtypAt4;
  const hasMoov = types.has('moov');
  const hasMvex = types.has('mvex') || boxPayloadHasType(bytes, boxes, 'moov', 'mvex');
  const hasMoof = types.has('moof');
  const hasMdat = types.has('mdat');

  const total =
    typeof input.resourceTotalBytes === 'number' &&
    Number.isFinite(input.resourceTotalBytes) &&
    input.resourceTotalBytes > 0
      ? Math.trunc(input.resourceTotalBytes)
      : null;

  const coversEntire =
    input.coversEntireResource === true ||
    (total != null && bytes.length >= total);

  const base = {
    hasFtyp,
    hasMoov,
    hasMvex,
    hasMoof,
    hasMdat,
    firstBoxType,
    boxesScanned: boxes.length,
  };

  if (total != null && boxes.some((box) => box.offset + box.size > total)) {
    return { ...base, kind: 'UNKNOWN', reason: 'invalid_box_size' };
  }

  // Media fragment: typically starts with moof; no initialization boxes.
  if (firstBoxType === 'moof' || (hasMoof && !hasMoov) || types.has('styp')) {
    return {
      ...base,
      kind: 'MEDIA_FRAGMENT',
      reason: 'moof_without_initialization',
    };
  }

  // Complete fragmented file in window.
  if (hasFtyp && hasMoov && hasMoof && hasMdat) {
    return {
      ...base,
      kind: 'FRAGMENTED_COMPLETE',
      reason: 'ftyp_moof_mdat',
    };
  }

  // Progressive / muxed file with media data visible.
  if (hasFtyp && hasMdat) {
    return {
      ...base,
      kind: 'PROGRESSIVE_OR_COMPLETE',
      reason: 'ftyp_mdat',
    };
  }

  // Legacy QuickTime may have no ftyp. Both metadata and data must be observed.
  if (!hasFtyp && hasMoov && hasMdat) {
    return { ...base, kind: 'PROGRESSIVE_OR_COMPLETE', reason: 'quicktime_moov_mdat' };
  }

  // Initialization segment: ftyp + moov, no mdat in scanned bytes.
  if (hasFtyp && hasMoov && !hasMdat) {
    if (coversEntire) {
      return {
        ...base,
        kind: 'INIT_SEGMENT',
        reason: 'ftyp_moov_no_mdat_entire_resource',
      };
    }
    if (total != null && total <= INIT_SEGMENT_SIZE_HINT_MAX && bytes.length >= total) {
      return {
        ...base,
        kind: 'INIT_SEGMENT',
        reason: 'ftyp_moov_no_mdat_small_total',
      };
    }
    // Large total — mdat likely later; treat as likely progressive.
    // Size is not proof that mdat exists later. A bounded probe stays unresolved.
    return {
      ...base,
      kind: 'UNKNOWN',
      reason: 'ftyp_moov_no_mdat_unknown_total',
    };
  }

  if (hasFtyp) {
    return {
      ...base,
      kind: 'UNKNOWN',
      reason: 'ftyp_incomplete_evidence',
    };
  }

  return {
    ...base,
    kind: 'UNKNOWN',
    reason: 'unrecognized_isom',
  };
}

export function isActionableStandaloneMp4(kind: Mp4ContainerKind): boolean {
  return kind === 'PROGRESSIVE_OR_COMPLETE' || kind === 'FRAGMENTED_COMPLETE';
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function readU64(bytes: Uint8Array, offset: number): number {
  // Bound to Number-safe sizes for classification windows.
  const hi = readU32(bytes, offset);
  const lo = readU32(bytes, offset + 4);
  if (hi > 0xffff) {
    return Number.POSITIVE_INFINITY;
  }
  return hi * 0x1_0000_0000 + lo;
}

function decodeType(bytes: Uint8Array, offset: number): string | null {
  let out = '';
  for (let i = 0; i < 4; i += 1) {
    const c = bytes[offset + i]!;
    if (c < 0x20 || c > 0x7e) {
      return null;
    }
    out += String.fromCharCode(c);
  }
  return out;
}

/** Shallow scan inside a parent box for a child type (e.g. mvex inside moov). */
function boxPayloadHasType(
  bytes: Uint8Array,
  boxes: Mp4BoxSummary[],
  parentType: string,
  childType: string,
): boolean {
  const parent = boxes.find((b) => b.type === parentType);
  if (!parent) {
    return false;
  }
  const start = parent.offset + 8;
  const end = Math.min(bytes.length, parent.offset + parent.size);
  if (end - start < 8) {
    return false;
  }
  const children = readMp4Boxes(bytes.subarray(start, end), 32);
  return children.some((c) => c.type === childType);
}
