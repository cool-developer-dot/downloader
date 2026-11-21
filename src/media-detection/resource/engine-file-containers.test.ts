import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sniffMediaSignature } from '@/downloads/engine/media-signature';

import { resolveVideoResource } from './video-resource';

/** 64 KiB of aligned MPEG-TS packets (sync byte every 188 bytes) and an FLV header followed by tag data. */
function transportStream(): Uint8Array {
  const bytes = new Uint8Array(188 * 350);
  for (let at = 0; at < bytes.length; at += 188) bytes[at] = 0x47;
  return bytes;
}

function flv(): Uint8Array {
  const bytes = new Uint8Array(32 * 1024);
  bytes.set([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 9]);
  return bytes;
}

test('FLV files are recognised by their header', () => {
  assert.deepEqual(sniffMediaSignature(flv()), { ok: true, kind: 'flv', reason: null });
  // `FLV` with a version that does not exist is not one.
  const other = flv();
  other[3] = 9;
  assert.equal(sniffMediaSignature(other).kind, 'unknown');
});

test('MPEG-TS and FLV bytes are verified for the engine to classify, never refused as an unknown format', () => {
  for (const [url, mimeType, bytes] of [
    ['https://archive.example.org/rec/news.ts', 'video/mp2t', transportStream()],
    ['https://cdn.example.com/old/clip.flv', 'video/x-flv', flv()],
    ['https://cdn.example.com/dl?id=4', 'application/octet-stream', flv()],
  ] as const) {
    const resolved = resolveVideoResource({ url, mimeType, bytes, totalBytes: 1_000_000 });
    assert.equal(resolved.state, 'VERIFIED', url);
    assert.equal(resolved.reason, 'ENGINE_FILE_CONTAINER', url);
  }
});

test('a lone segment stays refused when the caller knows it is one', () => {
  const resolved = resolveVideoResource({ url: 'https://cdn.example.com/seg/12.ts', bytes: transportStream(), isSegment: true });
  assert.equal(resolved.state, 'PROVEN_UNSUPPORTED');
  assert.equal(resolved.reason, 'SEGMENT_RESOURCE');
});

test('a Matroska file is MKV, a WebM is WebM, and both verify', () => {
  const ebml = (docType: string) => {
    const bytes = new Uint8Array(32 * 1024);
    bytes.set([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, ...Array.from(docType, (c) => c.charCodeAt(0))]);
    return bytes;
  };
  assert.equal(sniffMediaSignature(ebml('matroska')).kind, 'mkv');
  assert.equal(sniffMediaSignature(ebml('webm')).kind, 'webm');
  const mkv = resolveVideoResource({ url: 'https://cdn.example.com/a.mkv', mimeType: 'video/x-matroska', bytes: ebml('matroska'), totalBytes: 1_000_000 });
  assert.equal(mkv.state, 'VERIFIED');
  assert.equal(mkv.reason, 'ENGINE_FILE_CONTAINER');
  const webm = resolveVideoResource({ url: 'https://cdn.example.com/a.webm', mimeType: 'video/webm', bytes: ebml('webm'), totalBytes: 1_000_000 });
  assert.equal(webm.state, 'VERIFIED');
  assert.equal(webm.format, 'webm');
});
