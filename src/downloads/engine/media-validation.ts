import { File, FileMode } from 'expo-file-system';

import {
  MIN_VALID_MEDIA_BYTES,
  sniffMediaSignature,
  type MediaSignatureResult,
} from './media-signature';

const HEAD_READ_BYTES = 512;

export { MIN_VALID_MEDIA_BYTES, sniffMediaSignature } from './media-signature';
export type { MediaSignatureResult } from './media-signature';

export async function verifyDownloadedMediaContent(
  file: File,
): Promise<
  | { ok: true; kind: MediaSignatureResult['kind'] }
  | { ok: false; reason: string; kind?: MediaSignatureResult['kind'] }
> {
  if (!file.exists) {
    return { ok: false, reason: 'missing' };
  }

  const size =
    typeof file.size === 'number' && Number.isFinite(file.size)
      ? Math.trunc(file.size)
      : 0;
  if (size < MIN_VALID_MEDIA_BYTES) {
    return { ok: false, reason: 'too_small' };
  }

  const reader = file.open(FileMode.ReadOnly);
  try {
    // Small files: scan entire body so init segments without trailing mdat are caught.
    // Large files: scan a bounded prefix; large totals without mdat still classify as progressive.
    const readBytes =
      size <= 1024 * 1024 ? size : Math.min(size, 256 * 1024);
    const chunk = reader.readBytes(readBytes);
    if (!chunk || chunk.byteLength < 12) {
      return { ok: false, reason: 'unreadable' };
    }
    const bytes = new Uint8Array(chunk);
    const sig = sniffMediaSignature(bytes, {
      resourceTotalBytes: size,
      coversEntireResource: bytes.byteLength >= size,
      requireStandaloneMp4: true,
    });
    if (!sig.ok) {
      return { ok: false, reason: sig.reason ?? sig.kind, kind: sig.kind };
    }
    return { ok: true, kind: sig.kind };
  } finally {
    try {
      reader.close();
    } catch {
      // ignore
    }
  }
}
