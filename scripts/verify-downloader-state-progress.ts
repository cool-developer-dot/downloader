/**
 * Downloader state, progress, and stall invariant tests.
 * Run: npx tsx scripts/verify-downloader-state-progress.ts
 */

import { buildAnalysisFromVerification } from '../src/downloads/analyze/analyze-from-verification';
import {
  assertProgressStatusInvariant,
  computeProgressPercent,
  normalizeTotalBytes,
} from '../src/downloads/engine/progress';
import { deriveDownloadExecutionDisplayState } from '../src/downloads/execution/display-status';
import {
  getSourceCapability,
  shouldUseMultiRangeForSource,
} from '../src/downloads/engine/source-capability';
import { MIN_VALID_MEDIA_BYTES, sniffMediaSignature } from '../src/downloads/engine/media-signature';
import { DOWNLOAD_ENGINE } from '../src/downloads/engine/constants';
import { StallWatchdog } from '../src/downloads/engine/stall-watchdog';
import { resolveDownloadTitle, resolveDownloadFileName } from '../src/downloads/quality/download-metadata';
import { toCreateDownloadInput } from '../src/downloads/quality/to-create-input';
import { isLibraryCandidate } from '../src/library/eligibility';
import type { MediaRequestContext } from '../src/downloads/types/request-context';
import { normalizeAnalysisToSelection } from '../src/downloads/quality/normalize';
import { emptyAnalysis } from '../src/downloads/analyze/format';

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

const html419 = new TextEncoder().encode('<!doctype html><html><body>x');
assert(html419.length < MIN_VALID_MEDIA_BYTES, '419-byte HTML below minimum');
assert(!sniffMediaSignature(html419).ok, '419-byte HTML rejected');

const json733 = new TextEncoder().encode('{"error":"denied"}');
assert(json733.length < MIN_VALID_MEDIA_BYTES, '733-byte JSON below minimum');
assert(!sniffMediaSignature(json733).ok, '733-byte JSON rejected');

assert(
  !assertProgressStatusInvariant({
    status: 'QUEUED',
    bytesWritten: 1024,
    hasActiveWorker: true,
  }),
  'QUEUED + active worker without STARTING violates invariant',
);
assert(
  assertProgressStatusInvariant({
    status: 'QUEUED',
    bytesWritten: 1024,
    hasActiveWorker: true,
    executionState: 'STARTING',
  }),
  'QUEUED + STARTING execution with active worker is valid',
);
assert(
  assertProgressStatusInvariant({
    status: 'DOWNLOADING',
    bytesWritten: 1024,
    executionState: 'DOWNLOADING',
  }),
  'DOWNLOADING + bytes is valid',
);

assert(computeProgressPercent(0, 1_000_000) === 0, '0% at start');
assert(computeProgressPercent(500_000, 1_000_000) === 50, '50% mid transfer');
assert(computeProgressPercent(1_000_000, 1_000_000) === 100, '100% when bytes complete');
assert(computeProgressPercent(500, null) === 0, 'unknown total → 0% not fake');

assert(
  deriveDownloadExecutionDisplayState({
    status: 'DOWNLOADING',
    workerState: 'VERIFYING',
    appState: 'active',
  }) === 'FINALIZING',
  'VERIFYING → FINALIZING display',
);
assert(
  deriveDownloadExecutionDisplayState({
    status: 'DOWNLOADING',
    localState: 'finalizing',
    appState: 'active',
  }) === 'FINALIZING',
  'finalizing localState → FINALIZING display',
);

const tiktokCdn =
  'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tiktok_video.mp4';
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

const cap = getSourceCapability(tiktokCdn, ctx);
assert(cap.preferSingleStream === true, 'TikTok preferSingleStream');
assert(cap.supportsMultiRange === false, 'TikTok supportsMultiRange false');
assert(!shouldUseMultiRangeForSource(tiktokCdn, ctx), 'multi-range disabled for TikTok');

const title = resolveDownloadTitle({
  title: 'e06b1131f6f7457d9c584ea425a1f9eb',
  platform: 'TIKTOK',
});
assert(title === 'TikTok Video', 'hash title sanitized');
const fileName = resolveDownloadFileName({ title, platform: 'TIKTOK', containerExt: 'mp4' });
assert(fileName.startsWith('VidoraX_TikTok_'), 'clean TikTok timestamp filename');
assert(!fileName.includes('vidorax_download'), 'no generic vidorax_download name');

const tinySelection = normalizeAnalysisToSelection(
  emptyAnalysis('https://cdn.example.com/x.mp4', {
    downloadable: true,
    fileSize: 419,
    variants: [
      {
        id: 'v0',
        label: 'Original Quality',
        sourceUrl: 'https://cdn.example.com/x.mp4',
        streamType: 'PROGRESSIVE',
        container: 'mp4',
        mimeType: 'video/mp4',
        downloadable: true,
        unsupportedReason: null,
        resolution: null,
        width: null,
        height: null,
        bitrate: null,
        averageBitrate: null,
        videoBitrate: null,
        audioBitrate: null,
        codec: null,
        videoCodec: null,
        audioCodec: null,
        estimatedFileSize: 419,
        fileSize: 419,
        frameRate: null,
        originalIndex: 0,
      },
    ],
  }),
);
const tinyCreate = toCreateDownloadInput(
  tinySelection,
  tinySelection.options[0] ?? null,
);
assert(tinyCreate === null, 'tiny 419B payload blocked at create');

assert(
  !isLibraryCandidate({
    downloadId: 'd1',
    status: 'FAILED',
    localUri: 'file:///tmp/x.mp4',
  }),
  'failed item not library eligible',
);
assert(
  isLibraryCandidate({
    downloadId: 'd2',
    status: 'COMPLETED',
    localUri: 'file:///tmp/valid.mp4',
    localState: 'complete',
  }),
  'completed item library eligible',
);

assert(
  normalizeTotalBytes(0) === null,
  'zero total treated as unknown',
);

assert(DOWNLOAD_ENGINE.transferStallInactivityMs > 0, 'stall timeout configured');
assert(DOWNLOAD_ENGINE.finalizationTimeoutMs > 0, 'finalization timeout configured');

async function testStallWatchdog(): Promise<void> {
  let stallFired = false;
  const watchdog = new StallWatchdog({
    inactivityMs: 50,
    shouldPause: () => false,
    onStall: () => {
      stallFired = true;
    },
  });
  watchdog.start();
  await new Promise((r) => setTimeout(r, 80));
  try {
    watchdog.assertHealthy();
    assert(false, 'stall watchdog should throw');
  } catch {
    assert(stallFired, 'stall watchdog exits stuck state');
  }
  watchdog.stop();
}

async function main(): Promise<void> {
await testStallWatchdog();

const verification = {
  ok: true as const,
  finalUrl: tiktokCdn,
  mimeType: 'video/mp4',
  contentLength: 20_000_000,
  acceptRanges: true,
  status: 200,
  redirectCount: 0,
  confidenceBoost: 0.15,
  rejectionReason: null,
};
const media = {
  id: 'm1',
  url: tiktokCdn,
  sourceUrl: tiktokCdn,
  finalUrl: tiktokCdn,
  pageUrl: 'https://www.tiktok.com/@user/video/123',
  title: '@creator — TikTok Video',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  duration: 32,
  width: 1080,
  height: 1920,
  resolution: '1080x1920',
  aspectRatio: 0.5625,
  fps: 30,
  estimatedFileSize: 20_000_000,
  codec: 'h264',
  audioCodec: 'aac',
  bitrate: 5_000_000,
  mimeType: 'video/mp4',
  extension: 'mp4',
  container: 'mp4' as const,
  category: 'video' as const,
  streamType: 'DIRECT' as const,
  isLive: false,
  isDrm: false,
  playlistType: null,
  streamProtocol: null,
  websiteSource: null,
  confidence: 0.9,
  detectionSource: 'network_request' as const,
  detectedAt: Date.now(),
  requiresCookies: true,
  requiredHeaders: {},
  isFalsePositive: false,
};
const analysis = buildAnalysisFromVerification(
  verification,
  media,
  'https://www.tiktok.com/@user/video/123',
);
assert(analysis.downloadable === true, 'fast analyze produces downloadable result');
assert(Number(analysis.fileSize) === 20_000_000, 'fast analyze preserves content length');
assert(analysis.title === '@creator — TikTok Video', 'page title preserved in analyze');

console.log(`\nDownloader state/progress: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
}

void main();
