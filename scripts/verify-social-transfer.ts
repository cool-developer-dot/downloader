/**
 * Social CDN transfer regression tests.
 * Run: npx tsx scripts/verify-social-transfer.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import { buildDownloadHeaders } from '../src/downloads/engine/download-headers';
import {
  detectSocialCdnKind,
  isSocialCdnUrl,
  shouldUseAuthenticatedFetchTransfer,
  shouldUseMultiRangeForSource,
} from '../src/downloads/engine/source-capability';
import {
  MIN_VALID_MEDIA_BYTES,
  sniffMediaSignature,
} from '../src/downloads/engine/media-signature';
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

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const tiktokCdn =
  'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tiktok_video.mp4';
const igCdn =
  'https://scontent.cdninstagram.com/v/t51.2885-15/reel.mp4';
const directCdn = 'https://cdn.example.com/large-file.mp4';

const ctx: MediaRequestContext = {
  pageUrl: 'https://www.tiktok.com/@user/video/123',
  referer: 'https://www.tiktok.com/@user/video/123',
  userAgent: 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
  cookiesRequired: true,
  hasCookies: true,
  headers: {
    Accept: '*/*',
    Referer: 'https://www.tiktok.com/@user/video/123',
    'User-Agent': 'Mozilla/5.0 VidoraXBrowser/1.0 Mobile',
    Cookie: 'session=secret',
  },
  capturedAt: Date.now(),
};

assert(detectSocialCdnKind(tiktokCdn) === 'tiktok', 'detects TikTok CDN host');
assert(detectSocialCdnKind(igCdn) === 'instagram', 'detects Instagram CDN host');
assert(!isSocialCdnUrl(directCdn), 'generic CDN is not social');

assert(
  !shouldUseMultiRangeForSource(tiktokCdn, ctx),
  'multi-range disabled for TikTok CDN',
);
assert(
  !shouldUseMultiRangeForSource(igCdn, ctx),
  'multi-range disabled for Instagram CDN',
);
assert(
  shouldUseMultiRangeForSource(directCdn, null),
  'multi-range allowed for generic CDN without session',
);

assert(
  shouldUseAuthenticatedFetchTransfer(tiktokCdn, ctx),
  'TikTok uses authenticated fetch transfer',
);
assert(
  shouldUseAuthenticatedFetchTransfer(igCdn, ctx),
  'Instagram uses authenticated fetch transfer',
);

const headers = buildDownloadHeaders(ctx);
assert(headers.Referer === ctx.referer, 'Referer preserved in download headers');
assert(headers.Cookie === 'session=secret', 'Cookie preserved in download headers');
assert(headers['User-Agent'] === ctx.userAgent, 'User-Agent preserved');

const html733 = new TextEncoder().encode('<!doctype html><html><body>denied');
assert(html733.length < MIN_VALID_MEDIA_BYTES, '733-byte HTML below minimum');
assert(!sniffMediaSignature(html733).ok, '733-byte HTML rejected by signature');

const jsonErr = new TextEncoder().encode('{"error":"denied"}');
assert(!sniffMediaSignature(jsonErr).ok, 'JSON response rejected');

const mp4Head = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);
assert(sniffMediaSignature(mp4Head).ok, 'valid MP4 signature accepted');

const workerSrc = read('src/downloads/engine/worker.ts');
assert(
  workerSrc.includes('fetchSingleStreamTransfer'),
  'worker uses authenticated fetch for social CDN',
);
assert(
  workerSrc.includes('shouldUseMultiRangeForSource'),
  'worker gates multi-range by source capability',
);
assert(workerSrc.includes('assertSessionContextReady'), 'worker validates session context');

const fetchSrc = read('src/downloads/engine/fetch-single-stream-transfer.ts');
assert(
  fetchSrc.includes('assertValidMediaHttpResponse'),
  'fetch transfer validates HTTP before writing',
);
assert(
  fetchSrc.includes('sniffMediaSignature'),
  'fetch transfer sniffs prefix while streaming',
);

const managerSrc = read('src/downloads/engine/manager.ts');
assert(
  managerSrc.includes('requestContext: meta?.requestContext'),
  'recovery re-enqueue preserves request context',
);

const diagSrc = read('src/downloads/engine/social-download-diagnostics.service.ts');
assert(diagSrc.includes('[SocialDownload:'), 'social download diagnostics prefix');
assert(!diagSrc.includes('cookie:'), 'diagnostics do not log cookie keys with values');

const ctxSrc = read('src/media-detection/services/request-context.service.ts');
assert(ctxSrc.includes('socialPage'), 'social pages always attempt cookie attach');

console.log(`\nSocial transfer: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
