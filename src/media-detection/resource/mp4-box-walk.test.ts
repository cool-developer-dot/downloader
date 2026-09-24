import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { DetectedMedia } from '../types';
import { verifySocialSourceCandidate } from '../social-source/social-source-reliability.service';
import { nextTopLevelBoxOffset, walkMp4TopLevelBoxes } from './mp4-box-walk';
import { resolveVideoResource } from './video-resource';

const WINDOW = 16 * 1024;

function box(type: string, size: number, fill?: (payload: Uint8Array) => void): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i += 1) bytes[4 + i] = type.charCodeAt(i);
  fill?.(bytes.subarray(8));
  return bytes;
}

function ftyp(major = 'isom'): Uint8Array<ArrayBuffer> {
  return box('ftyp', 32, (payload) => {
    const brands = `${major}\0\0\x02\0isomiso2avc1mp41`;
    for (let i = 0; i < 24; i += 1) payload[i] = brands.charCodeAt(i);
  });
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** ftyp(32) + moov(40 KB, larger than the probe window) + free(8) + mdat. */
function faststartMp4(options: { major?: string; afterMoov?: Uint8Array[] } = {}): Uint8Array<ArrayBuffer> {
  const moov = box('moov', 40_000, (payload) => payload.set(box('mvhd', 108), 0));
  const after = options.afterMoov ?? [box('free', 8), box('mdat', 150_000)];
  return concat(ftyp(options.major), moov, ...after);
}

function headerReader(file: Uint8Array) {
  const offsets: number[] = [];
  return {
    offsets,
    readHeader: async (offset: number) => {
      offsets.push(offset);
      return offset < file.length ? file.subarray(offset, Math.min(file.length, offset + 16)) : null;
    },
  };
}

describe('MP4 box walk past the probe window', () => {
  test('next box offset comes from the declared size of the truncated moov', () => {
    const file = faststartMp4();
    assert.equal(nextTopLevelBoxOffset(file.subarray(0, WINDOW)), 32 + 40_000);
  });

  test('faststart moov → free → mdat is media data (two 16-byte reads)', async () => {
    const file = faststartMp4();
    const reader = headerReader(file);
    const walk = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length, readHeader: reader.readHeader });
    assert.deepEqual(walk, { state: 'MEDIA_DATA', boxType: 'mdat', offset: 40_040, hops: 2 });
    assert.deepEqual(reader.offsets, [40_032, 40_040]);
  });

  test('ftyp + moov ending exactly at the resource total is a proven init segment', async () => {
    const file = faststartMp4({ afterMoov: [] });
    const walk = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length, readHeader: async () => null });
    assert.equal(walk.state, 'NO_MEDIA_DATA');
  });

  test('moov followed by moof is a standalone fragmented file', async () => {
    const file = faststartMp4({ afterMoov: [box('moof', 600), box('mdat', 20_000)] });
    const walk = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length, readHeader: headerReader(file).readHeader });
    assert.equal(walk.state, 'MEDIA_DATA');
    assert.equal(walk.state === 'MEDIA_DATA' && walk.boxType, 'moof');
  });

  test('mdat declaring more bytes than the resource is invalid', async () => {
    const file = faststartMp4();
    const walk = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length - 1_000, readHeader: headerReader(file).readHeader });
    assert.equal(walk.state, 'INVALID');
  });

  test('no Range support or unexpected boxes stay unresolved (transient, never unsupported)', async () => {
    const noRange = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: 190_040, readHeader: async () => null });
    assert.equal(noRange.state, 'UNRESOLVED');
    const file = faststartMp4({ afterMoov: [box('zzzz', 64), box('mdat', 1_000)] });
    const odd = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length, readHeader: headerReader(file).readHeader });
    assert.equal(odd.state, 'UNRESOLVED');
  });

  test('hop limit bounds the number of requests', async () => {
    const frees = Array.from({ length: 10 }, () => box('free', 8));
    const file = faststartMp4({ afterMoov: [...frees, box('mdat', 1_000)] });
    const reader = headerReader(file);
    const walk = await walkMp4TopLevelBoxes({ startOffset: 40_032, totalBytes: file.length, readHeader: reader.readHeader });
    assert.equal(walk.state, 'UNRESOLVED');
    assert.equal(reader.offsets.length, 4);
  });
});

describe('resolveVideoResource with box-walk evidence (one verdict)', () => {
  const base = { url: 'https://cdn.example.net/v/abc123?token=t', mimeType: 'video/mp4' };

  test('window alone is unresolved, walk-proven media data is VERIFIED mp4', () => {
    const file = faststartMp4();
    const bytes = file.subarray(0, WINDOW);
    assert.equal(resolveVideoResource({ ...base, bytes, totalBytes: file.length }).state, 'TRANSIENT_UNRESOLVED');
    const verified = resolveVideoResource({
      ...base, bytes, totalBytes: file.length,
      mp4BoxWalk: { state: 'MEDIA_DATA', boxType: 'mdat', offset: 40_040, hops: 2 },
    });
    assert.equal(verified.state, 'VERIFIED');
    assert.equal(verified.format, 'mp4');
    assert.equal(verified.standaloneFragmented, false);
  });

  test('QuickTime brand resolves to mov', () => {
    const file = faststartMp4({ major: 'qt  ' });
    const verified = resolveVideoResource({
      ...base, mimeType: 'video/quicktime', bytes: file.subarray(0, WINDOW), totalBytes: file.length,
      mp4BoxWalk: { state: 'MEDIA_DATA', boxType: 'mdat', offset: 40_040, hops: 2 },
    });
    assert.equal(verified.format, 'mov');
  });

  test('walk-proven init segment and invalid sizes are proven unsupported', () => {
    const file = faststartMp4();
    const bytes = file.subarray(0, WINDOW);
    assert.equal(
      resolveVideoResource({ ...base, bytes, totalBytes: 40_032, mp4BoxWalk: { state: 'NO_MEDIA_DATA', reason: 'ends_after_metadata', hops: 0 } }).state,
      'PROVEN_UNSUPPORTED',
    );
    assert.equal(
      resolveVideoResource({ ...base, bytes, totalBytes: file.length, mp4BoxWalk: { state: 'INVALID', reason: 'box_exceeds_resource', hops: 2 } }).reason,
      'invalid_box_size',
    );
  });

  test('declared WebM over ISO bytes is still a MIME/signature mismatch', () => {
    const file = faststartMp4();
    const result = resolveVideoResource({
      ...base, mimeType: 'video/webm', bytes: file.subarray(0, WINDOW), totalBytes: file.length,
      mp4BoxWalk: { state: 'MEDIA_DATA', boxType: 'mdat', offset: 40_040, hops: 2 },
    });
    assert.equal(result.state, 'PROVEN_UNSUPPORTED');
  });

  test('encryption evidence inside the window wins over the walk (DRM)', () => {
    const moov = box('moov', 40_000, (payload) => payload.set(box('pssh', 64), 200));
    const file = concat(ftyp(), moov, box('mdat', 10_000));
    const result = resolveVideoResource({
      ...base, bytes: file.subarray(0, WINDOW), totalBytes: file.length,
      mp4BoxWalk: { state: 'MEDIA_DATA', boxType: 'mdat', offset: 40_032, hops: 1 },
    });
    assert.equal(result.state, 'PROVEN_UNSUPPORTED');
  });
});

describe('L: HTTP-verified extensionless MP4 → bounded byte probe agree', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function serve(file: Uint8Array<ArrayBuffer>, options: { honourRange?: boolean } = {}) {
    const requests: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const method = (init?.method ?? 'GET').toUpperCase();
      const range = headers.get('Range');
      requests.push(`${method} ${range ?? '-'}`);
      const common = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };
      const match = /bytes=(\d+)-(\d*)/.exec(range ?? '');
      if (match && options.honourRange !== false) {
        const start = Number(match[1]);
        const end = Math.min(file.length - 1, match[2] ? Number(match[2]) : file.length - 1);
        return new Response(method === 'HEAD' ? null : file.slice(start, end + 1), {
          status: 206,
          headers: { ...common, 'Content-Range': `bytes ${start}-${end}/${file.length}`, 'Content-Length': String(end - start + 1) },
        });
      }
      return new Response(method === 'HEAD' ? null : file, {
        status: 200,
        headers: { ...common, 'Content-Length': String(file.length) },
      });
    }) as typeof fetch;
    return requests;
  }

  const media = {
    id: 'm1',
    url: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc&expires=4102444800',
    finalUrl: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc&expires=4102444800',
    sourceUrl: 'https://edge7.cdnhost.net/o/9f3a1c?token=abc&expires=4102444800',
    pageUrl: 'https://news.example.org/story/42',
    mimeType: null,
    extension: null,
    container: 'unknown',
    category: 'video',
    streamType: 'DIRECT',
    detectedAt: Date.now(),
    isDrm: false,
  } as unknown as DetectedMedia;
  const context = { referer: 'https://news.example.org/', userAgent: null, cookiesRequired: false, hasCookies: false } as never;

  test('large-moov faststart MP4 verifies instead of PROBE_FAILED', async () => {
    const requests = serve(faststartMp4());
    const result = await verifySocialSourceCandidate(media, { pageUrl: media.pageUrl, requestContext: context });
    assert.equal(result.ok, true, JSON.stringify(result.ok ? null : result.reason));
    assert.ok(result.ok && result.signatureKind === 'mp4');
    // Metadata probe(s), one 16 KB window, then two 16-byte box headers — never the whole file.
    assert.ok(requests.includes('GET bytes=40032-40047'), requests.join(' | '));
    assert.ok(requests.includes('GET bytes=40040-40055'), requests.join(' | '));
  });

  test('isolated init segment (ftyp + large moov only) is rejected as INIT_SEGMENT', async () => {
    serve(faststartMp4({ afterMoov: [] }));
    const result = await verifySocialSourceCandidate(media, { pageUrl: media.pageUrl, requestContext: context });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'INIT_SEGMENT');
  });

  test('M: server without Range support stays transient (PROBE_FAILED), not proven unsupported', async () => {
    serve(faststartMp4(), { honourRange: false });
    const result = await verifySocialSourceCandidate(media, { pageUrl: media.pageUrl, requestContext: context });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.reason, 'PROBE_FAILED');
  });
});
