/**
 * Bounded top-level ISO BMFF box walk for probes whose first window ends inside `moov`.
 *
 * Faststart MP4s put `moov` (sample tables) before `mdat`; for anything longer than a short clip `moov`
 * outgrows the first probe window, so the window alone can never show media data. Box headers declare
 * their sizes, so the box that follows can be read with a 16-byte Range request instead of buffering
 * `moov`. Sample data is never read. Isolated init segments end right after their metadata, which this
 * walk proves from the resource total instead of guessing from size.
 */
import { readMp4Boxes } from '@/downloads/engine/mp4-box-classify';

export type Mp4BoxWalkVerdict =
  | { state: 'MEDIA_DATA'; boxType: 'mdat' | 'moof'; offset: number; hops: number }
  | { state: 'NO_MEDIA_DATA'; reason: 'ends_after_metadata'; hops: number }
  | { state: 'INVALID'; reason: 'box_exceeds_resource'; hops: number }
  | { state: 'UNRESOLVED'; reason: string; hops: number };

/** Bytes needed for a box header, including a 64-bit largesize. */
export const MP4_BOX_HEADER_BYTES = 16;
export const MP4_BOX_WALK_MAX_HOPS = 4;

// Top-level boxes that may sit between metadata and media data without carrying samples.
const PASSTHROUGH_BOXES = new Set(['free', 'skip', 'wide', 'uuid', 'udta', 'meta', 'pdin', 'sidx', 'prft', 'emsg', 'bloc']);

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function boxType(bytes: Uint8Array, offset: number): string | null {
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

/**
 * Offset of the first top-level box that does not start inside `bytes`, from the declared size of the last
 * box that does. Null when that box runs to end of file (size 0) or the structure is unreadable.
 */
export function nextTopLevelBoxOffset(bytes: Uint8Array): number | null {
  const boxes = readMp4Boxes(bytes);
  const last = boxes[boxes.length - 1];
  if (!last || bytes.length < last.offset + 8) {
    return null;
  }
  if (u32(bytes, last.offset) === 0) {
    return null;
  }
  const end = last.offset + last.size;
  return Number.isSafeInteger(end) && end > last.offset ? end : null;
}

export async function walkMp4TopLevelBoxes(input: {
  startOffset: number;
  totalBytes: number | null;
  /** Up to MP4_BOX_HEADER_BYTES bytes starting exactly at `offset`, or null when unavailable. */
  readHeader: (offset: number) => Promise<Uint8Array | null>;
  maxHops?: number;
}): Promise<Mp4BoxWalkVerdict> {
  const maxHops = input.maxHops ?? MP4_BOX_WALK_MAX_HOPS;
  const total = input.totalBytes;
  let offset = input.startOffset;
  for (let hop = 0; hop < maxHops; hop += 1) {
    if (total != null) {
      if (offset === total) {
        return { state: 'NO_MEDIA_DATA', reason: 'ends_after_metadata', hops: hop };
      }
      if (offset > total) {
        return { state: 'INVALID', reason: 'box_exceeds_resource', hops: hop };
      }
    }
    const header = await input.readHeader(offset);
    if (!header || header.length < 8) {
      return { state: 'UNRESOLVED', reason: 'header_unavailable', hops: hop + 1 };
    }
    const type = boxType(header, 4);
    if (!type) {
      return { state: 'UNRESOLVED', reason: 'unreadable_box_type', hops: hop + 1 };
    }
    const size32 = u32(header, 0);
    let size = size32;
    if (size32 === 1) {
      if (header.length < 16) {
        return { state: 'UNRESOLVED', reason: 'largesize_unavailable', hops: hop + 1 };
      }
      const high = u32(header, 8);
      size = high > 0x1fffff ? Number.POSITIVE_INFINITY : high * 0x1_0000_0000 + u32(header, 12);
    }
    if (type === 'mdat' || type === 'moof') {
      // size 0: the box runs to end of file, which is valid for mdat.
      if (size32 !== 0 && (size < 8 || (total != null && offset + size > total))) {
        return { state: 'INVALID', reason: 'box_exceeds_resource', hops: hop + 1 };
      }
      return { state: 'MEDIA_DATA', boxType: type, offset, hops: hop + 1 };
    }
    if (!PASSTHROUGH_BOXES.has(type)) {
      return { state: 'UNRESOLVED', reason: `unexpected_box_${type}`, hops: hop + 1 };
    }
    if (size32 === 0 || !Number.isSafeInteger(size) || size < 8) {
      return { state: 'UNRESOLVED', reason: 'unbounded_box', hops: hop + 1 };
    }
    offset += size;
  }
  return { state: 'UNRESOLVED', reason: 'hop_limit', hops: maxHops };
}
