/**
 * P8 #461: what a file's first bytes say it is, when it is a program or an archive — the JavaScript copy of the
 * native `ContentSniff.kindOf` (vidorax-media `safety/ContentSniff.kt`), for bytes the browser's own verifier read.
 * Pure.
 */

import type { ContentKind } from '@modules/vidorax-media/src/VidoraMedia.types';

const APK_MARKERS = ['AndroidManifest.xml', 'classes.dex', 'resources.arsc'];

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function latin1(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}

function isPe(bytes: Uint8Array): boolean {
  if (bytes.length < 0x40) return true;
  const offset = bytes[0x3c]! | (bytes[0x3d]! << 8) | (bytes[0x3e]! << 16) | (bytes[0x3f]! << 24);
  if (offset < 0x40 || offset + 4 > bytes.length) return true;
  return bytes[offset] === 0x50 && bytes[offset + 1] === 0x45 && bytes[offset + 2] === 0 && bytes[offset + 3] === 0;
}

/** The program or archive [bytes] (a file's first bytes, up to 4 KB are read) are, or null for anything else. */
export function contentKindOf(bytes: Uint8Array | null | undefined): ContentKind | null {
  if (!bytes || bytes.length < 2) return null;
  const head = bytes.subarray(0, 4096);
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]) || startsWith(head, [0x50, 0x4b, 0x07, 0x08])) {
    const text = latin1(head);
    if (APK_MARKERS.some((marker) => text.includes(marker))) return 'apk';
    return text.includes('META-INF/MANIFEST.MF') ? 'jar' : 'zip';
  }
  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return 'elf';
  if (startsWith(head, [0x64, 0x65, 0x78, 0x0a]) && head.length >= 8 && head[7] === 0) return 'dex';
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'msi';
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe]].some((sig) => startsWith(head, sig))) {
    return 'macho';
  }
  if (head[0] === 0x4d && head[1] === 0x5a && isPe(head)) return 'exe';
  if (head.length >= 3 && head[0] === 0x23 && head[1] === 0x21 && head[2] === 0x2f) return 'script';
  return null;
}
