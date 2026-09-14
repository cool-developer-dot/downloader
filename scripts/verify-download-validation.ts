/**
 * Download validation + metadata regression tests.
 * Run: npx tsx scripts/verify-download-validation.ts
 */
import { buildDownloadHeaders, mergeResumeHeaders } from '../src/downloads/engine/download-headers';
import {
  sniffMediaSignature,
  MIN_VALID_MEDIA_BYTES,
} from '../src/downloads/engine/media-signature';
import {
  resolveDownloadFileName,
  resolveDownloadTitle,
  isHashLikeTitle,
} from '../src/downloads/quality/download-metadata';
import type { MediaRequestContext } from '../src/downloads/types/request-context';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

const mp4Head = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
assert(sniffMediaSignature(mp4Head).ok, 'valid MP4 passes');

const fmp4Head = new Uint8Array([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x35,
]);
assert(sniffMediaSignature(fmp4Head).ok, 'fragmented MP4 passes');

const htmlHead = new TextEncoder().encode('<!doctype html><html><body>denied');
assert(!sniffMediaSignature(htmlHead).ok, 'HTML response fails');

const jsonHead = new TextEncoder().encode('{"error":"denied"}');
assert(!sniffMediaSignature(jsonHead).ok, 'JSON response fails');

const truncated = new Uint8Array(100).fill(0x00);
truncated[4] = 0x66;
truncated[5] = 0x74;
truncated[6] = 0x79;
truncated[7] = 0x70;
assert(truncated.length < MIN_VALID_MEDIA_BYTES, 'truncated sample below minimum');

assert(isHashLikeTitle('e06b1131f6f7457d9c584ea425a1f9eb'), 'detects hash-like title');
const title = resolveDownloadTitle({
  title: 'e06b1131f6f7457d9c584ea425a1f9eb',
  platform: 'TIKTOK',
});
assert(title === 'TikTok Video', 'uses platform title instead of hash');
assert(
  !resolveDownloadFileName({ title, platform: 'TIKTOK', containerExt: 'mp4' }).includes(
    'e06b1131',
  ),
  'filename avoids internal hash',
);
assert(
  resolveDownloadFileName({ title, platform: 'TIKTOK', containerExt: 'mp4' }).includes('TikTok'),
  'clean TikTok filename',
);

const ctx: MediaRequestContext = {
  pageUrl: 'https://www.tiktok.com/@user/video/123',
  referer: 'https://www.tiktok.com/@user/video/123',
  userAgent: 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
  cookiesRequired: true,
  hasCookies: true,
  headers: {
    Referer: 'https://www.tiktok.com/@user/video/123',
    'User-Agent': 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
    Cookie: 'session=secret',
    Accept: '*/*',
  },
  capturedAt: Date.now(),
};

const headers = buildDownloadHeaders(ctx);
assert(Boolean(headers.Referer), 'TikTok request context includes Referer');
assert(Boolean(headers.Cookie), 'TikTok request context includes Cookie');
assert(Boolean(headers['User-Agent']), 'TikTok request context includes User-Agent');

const resumed = mergeResumeHeaders({ Range: 'bytes=100-' }, ctx);
assert(Boolean(resumed.Cookie), 'resume merge restores Cookie');
assert(resumed.Range === 'bytes=100-', 'resume merge preserves Range');

console.log(`\nDownload validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
