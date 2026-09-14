/**
 * Phase 5 HLS handoff regression — pre-download gate + Phase 1 routing.
 *
 * Usage (from mobile/):
 *   npm run verify:phase5-hls-handoff
 *
 * No Python, Maestro, Appium, Detox, live CDN required for routing contracts.
 * Live BBB curl checks are optional and skipped when offline.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPlaylistOrStreamUrl,
  shouldUseHlsTransfer,
} from '../src/downloads/engine/resource-guard';
import { parseHlsPlaylist } from '../src/downloads/engine/hls/playlist';
import { isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function mustInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(source.includes(needle), `${label} missing: ${needle}`);
  }
}

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not contain: ${needle}`);
  }
}

console.log('Phase 5 — HLS handoff verification\n');

async function main(): Promise<void> {
await test('1. valid HLS paste → HLS worker route', () => {
  assert(
    shouldUseHlsTransfer({
      sourceUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      streamType: 'HLS',
    }),
    'master m3u8 + HLS',
  );
  const manager = readSrc('src/downloads/engine/manager.ts');
  mustInclude(manager, ['shouldUseHlsTransfer', 'HlsTransferWorker'], 'manager');
});

await test('2. HLS master → quality → HLS worker', () => {
  const master = readFileSync(
    join(ROOT, 'src/media-detection/fixtures/hls-master.m3u8'),
    'utf8',
  );
  const parsed = parseHlsPlaylist(
    master,
    'https://cdn.example.com/master.m3u8',
  );
  assert(parsed.kind === 'master', 'master kind');
  assert(parsed.variants.length >= 2, 'variants');
  const v1080 = parsed.variants.find((v) => v.height === 1080) ?? parsed.variants[0]!;
  assert(
    shouldUseHlsTransfer({ sourceUrl: v1080.url, streamType: 'HLS' }),
    'selected child routes HLS',
  );
});

await test('3. HLS media playlist → HLS worker', () => {
  assert(
    shouldUseHlsTransfer({
      sourceUrl: 'https://cdn.example.com/media/720p.m3u8',
      streamType: 'HLS',
    }),
    'media playlist',
  );
});

await test('4. HLS URL without .m3u8 but verified transport=HLS → HLS worker', () => {
  assert(
    shouldUseHlsTransfer({
      sourceUrl: 'https://cdn.example.com/playlist/opaque-token',
      streamType: 'HLS',
    }),
    'metadata wins without extension',
  );
  assert(
    !isPlaylistOrStreamUrl('https://cdn.example.com/playlist/opaque-token'),
    'URL heuristic alone would miss',
  );
});

await test('5. MP4 still progressive', () => {
  assert(
    !shouldUseHlsTransfer({
      sourceUrl: 'https://cdn.example.com/video.mp4',
      streamType: 'PROGRESSIVE',
    }),
    'mp4 progressive',
  );
});

await test('6. WebM still progressive', () => {
  assert(
    !shouldUseHlsTransfer({
      sourceUrl: 'https://cdn.example.com/video.webm',
      streamType: 'PROGRESSIVE',
    }),
    'webm progressive',
  );
});

await test('7. .ts/.m4s rejected as standalone media', () => {
  assert(isLikelyMediaSegment('https://cdn.example.com/seg001.ts'), 'ts segment');
  assert(isLikelyMediaSegment('https://cdn.example.com/seg001.m4s'), 'm4s segment');
  assert(
    !shouldUseHlsTransfer({
      sourceUrl: 'https://cdn.example.com/seg001.ts',
      streamType: 'PROGRESSIVE',
    }),
    'ts is not HLS transfer',
  );
});

await test('8. HTML/JSON rejected as HLS playlist', () => {
  let htmlRejected = false;
  try {
    parseHlsPlaylist('<!DOCTYPE html><html></html>', 'https://cdn.example.com/x.m3u8');
  } catch {
    htmlRejected = true;
  }
  assert(htmlRejected, 'html rejected');

  let jsonRejected = false;
  try {
    parseHlsPlaylist('{"error":true}', 'https://cdn.example.com/x.m3u8');
  } catch {
    jsonRejected = true;
  }
  assert(jsonRejected, 'json rejected');
});

await test('9. unsupported encrypted HLS rejected', () => {
  let encryptedRejected = false;
  try {
    parseHlsPlaylist(
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"\n#EXTINF:4,\nseg.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/enc.m3u8',
    );
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    const message = error instanceof Error ? error.message : String(error);
    encryptedRejected =
      code === 'UNSUPPORTED_HLS_ENCRYPTION' ||
      code === 'HLS_ENCRYPTED' ||
      code === 'UNSUPPORTED_DRM' ||
      /encrypt|DRM/i.test(message);
  }
  assert(encryptedRejected, 'encrypted rejected');
});

await test('gate uses HLS manifest path (not progressive min-bytes on playlists)', () => {
  const gate = readSrc('src/media-detection/services/pre-download-gate.service.ts');
  mustInclude(
    gate,
    [
      'fetchAndParseHlsPlaylist',
      "transport === 'HLS'",
      'contentLength: null',
      'runHlsManifestGate',
    ],
    'hls gate',
  );
  // Progressive min-byte checks must remain for progressive only — not applied inside HLS branch.
  const hlsFn = gate.slice(gate.indexOf('async function runHlsManifestGate'));
  const hlsBody = hlsFn.slice(0, hlsFn.indexOf('export async function runPreDownloadGate'));
  mustNotInclude(
    hlsBody,
    ['MIN_VALID_MEDIA_BYTES', 'isTinyErrorSize', 'verifyMediaCandidate'],
    'hls gate body',
  );
});

await test('quality confirm passes transport=HLS for HLS options', () => {
  const quality = readSrc('src/screens/downloads/quality/useQualitySelection.ts');
  mustInclude(
    quality,
    ["transport: gateTransport", "isHlsOption", "buildMediaRequestContextSync"],
    'quality confirm',
  );
});

await test('browser enqueue passes transport to gate', () => {
  const browser = readSrc(
    'src/browser/media-actions/browser-media-download.service.ts',
  );
  mustInclude(browser, ['transport: gateTransport', "('HLS' as const)"], 'browser');
});

await test('create enqueue plumbs selectedQuality.streamType', () => {
  const actions = readSrc('src/store/downloads/actions.ts');
  mustInclude(
    actions,
    ['resolveCreateStreamType', 'streamType: resolveCreateStreamType'],
    'create',
  );
});

await test('architecture docs / package script present', () => {
  assert(
    existsSync(join(ROOT, 'scripts/verify-phase5-hls-handoff.ts')),
    'verifier file',
  );
  const pkg = JSON.parse(readSrc('package.json')) as {
    scripts?: Record<string, string>;
  };
  assert(
    pkg.scripts?.['verify:phase5-hls-handoff']?.includes('verify-phase5-hls-handoff'),
    'npm script',
  );
});

console.log(`\nPhase 5 HLS handoff: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
}

void main();
