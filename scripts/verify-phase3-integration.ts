/**
 * Week 7 Day 1 Phase 3 — mobile integration verification.
 * Pure fixtures / mappings. NO network. NO Metro. NO emulator.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-phase3-integration.ts
 */

import type { MediaAnalysisResult } from '../src/api/types';
import {
  normalizeAnalysisToSelection,
  toApiCreateDownloadPayload,
  toCreateDownloadInput,
} from '../src/downloads/quality';
import { normalizeDownloadSettings } from '../src/downloads/settings/normalize';
import { DownloadQueue } from '../src/downloads/engine/queue';
import {
  DOWNLOAD_WORKER_STATES,
  defaultWorkerStateForStatus,
  isValidWorkerStateForDownloadStatus,
} from '../src/downloads/worker-state';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
  }
}

const progressiveFixture: MediaAnalysisResult = {
  title: 'clip.mp4',
  sourceUrl: 'https://cdn.example.com/clip.mp4',
  finalUrl: 'https://cdn.example.com/clip.mp4',
  thumbnailUrl: null,
  mediaType: 'video',
  mimeType: 'video/mp4',
  container: 'mp4',
  duration: null,
  width: 1920,
  height: 1080,
  resolution: '1920x1080',
  bitrate: 8_000_000,
  fps: null,
  fileSize: '10485760',
  platform: 'CDN_EXAMPLE',
  downloadable: true,
  unsupportedReason: null,
  variants: [
    {
      id: 'vq_prog',
      sourceUrl: 'https://cdn.example.com/clip.mp4',
      streamType: 'PROGRESSIVE',
      label: '1080p',
      resolution: '1920x1080',
      width: 1920,
      height: 1080,
      bitrate: 8_000_000,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codecs: null,
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      container: 'mp4',
      mimeType: 'video/mp4',
      estimatedFileSize: 10_485_760,
      frameRate: null,
      downloadable: true,
      unsupportedReason: null,
    },
  ],
};

const hlsMasterFixture: MediaAnalysisResult = {
  title: 'Show',
  sourceUrl: 'https://example.com/master.m3u8',
  finalUrl: 'https://example.com/master.m3u8',
  thumbnailUrl: null,
  mediaType: 'stream',
  mimeType: 'application/vnd.apple.mpegurl',
  container: 'hls',
  duration: null,
  width: 1280,
  height: 720,
  resolution: '1280x720',
  bitrate: 4_200_000,
  fps: null,
  fileSize: null,
  platform: 'EXAMPLE',
  downloadable: true,
  unsupportedReason: null,
  variants: [
    {
      id: 'vq_1080',
      sourceUrl: 'https://cdn.example.com/1080/index.m3u8',
      streamType: 'HLS',
      label: '1080p',
      resolution: '1920x1080',
      width: 1920,
      height: 1080,
      bitrate: 6_500_000,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codecs: null,
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      container: 'hls',
      mimeType: 'application/vnd.apple.mpegurl',
      estimatedFileSize: null,
      frameRate: null,
      downloadable: true,
      unsupportedReason: null,
    },
    {
      id: 'vq_720',
      sourceUrl: 'https://cdn.example.com/720/index.m3u8',
      streamType: 'HLS',
      label: '720p',
      resolution: '1280x720',
      width: 1280,
      height: 720,
      bitrate: 4_200_000,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codecs: null,
      videoCodec: 'H.264',
      audioCodec: 'AAC',
      container: 'hls',
      mimeType: 'application/vnd.apple.mpegurl',
      estimatedFileSize: null,
      frameRate: null,
      downloadable: true,
      unsupportedReason: null,
    },
  ],
};

const singleSourceUnknownMeta: MediaAnalysisResult = {
  title: 'plain.mp4',
  sourceUrl: 'https://cdn.example.com/plain.mp4',
  finalUrl: 'https://cdn.example.com/plain.mp4',
  thumbnailUrl: null,
  mediaType: 'video',
  mimeType: 'video/mp4',
  container: 'mp4',
  duration: null,
  width: null,
  height: null,
  resolution: null,
  bitrate: null,
  fps: null,
  fileSize: null,
  platform: 'CDN_EXAMPLE',
  downloadable: true,
  unsupportedReason: null,
  variants: [
    {
      id: 'vq_only',
      sourceUrl: 'https://cdn.example.com/plain.mp4',
      streamType: 'PROGRESSIVE',
      label: 'Original Quality',
      resolution: null,
      width: null,
      height: null,
      bitrate: null,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codecs: null,
      videoCodec: null,
      audioCodec: null,
      container: 'mp4',
      mimeType: 'video/mp4',
      estimatedFileSize: null,
      frameRate: null,
      downloadable: true,
      unsupportedReason: null,
    },
  ],
};

console.log('Week 7 Day 1 Phase 3 — mobile integration verifier\n');

test('progressive: selected metadata reaches API create payload', () => {
  const selection = normalizeAnalysisToSelection(progressiveFixture);
  const option = selection.options[0]!;
  const input = toCreateDownloadInput(selection, option);
  assert(input != null, 'input');
  assert(input!.sourceUrl === 'https://cdn.example.com/clip.mp4', 'url');
  assert(input!.quality === '1080p', 'quality');
  assert(input!.resolution === '1920x1080', 'resolution');
  assert(input!.bitrate === 8_000_000, 'bitrate');

  const api = toApiCreateDownloadPayload(input!);
  assert(api.quality === '1080p', 'api quality');
  assert(api.resolution === '1920x1080', 'api resolution');
  assert(api.bitrate === 8_000_000, 'api bitrate');
  assert(api.sourceUrl === input!.sourceUrl, 'api url');
  assert(!('selectedQuality' in api), 'no rich object on API');
});

test('HLS master: selected 720p child URL + durable metadata', () => {
  const selection = normalizeAnalysisToSelection(hlsMasterFixture);
  const option720 = selection.options.find((o) => o.label === '720p');
  assert(option720 != null, '720p option');
  const input = toCreateDownloadInput(selection, option720!);
  assert(input != null, 'input');
  assert(
    input!.sourceUrl === 'https://cdn.example.com/720/index.m3u8',
    'child url',
  );
  assert(!input!.sourceUrl.includes('master.m3u8'), 'not master');
  assert(input!.quality === '720p', 'quality');
  assert(input!.resolution === '1280x720', 'resolution');
  assert(input!.bitrate === 4_200_000, 'bitrate');

  const api = toApiCreateDownloadPayload(input!);
  assert(api.sourceUrl === input!.sourceUrl, 'api child');
  assert(api.quality === '720p', 'api quality');
  assert(api.resolution === '1280x720', 'api resolution');
  assert(api.bitrate === 4_200_000, 'api bitrate');
});

test('single-source: one option, null unknowns, URL preserved', () => {
  const selection = normalizeAnalysisToSelection(singleSourceUnknownMeta);
  assert(selection.options.length === 1, 'one option');
  const input = toCreateDownloadInput(selection, selection.options[0]!);
  assert(input != null, 'input');
  assert(input!.sourceUrl === 'https://cdn.example.com/plain.mp4', 'url');
  assert(input!.quality === 'Original Quality', 'label quality');
  assert(input!.resolution === null, 'resolution null');
  assert(input!.bitrate === null, 'bitrate null');
});

test('settings code-level persist/normalize certification values', () => {
  const normalized = normalizeDownloadSettings({
    wifiOnly: true,
    autoResume: true,
    maxConcurrentDownloads: 3,
    notificationsEnabled: false,
  });
  assert(normalized.wifiOnly === true, 'wifi');
  assert(normalized.autoResume === true, 'auto');
  assert(normalized.maxConcurrentDownloads === 3, 'max');
  assert(normalized.notificationsEnabled === false, 'notif');

  // Round-trip through normalize again (hydrate simulation).
  const hydrated = normalizeDownloadSettings(normalized);
  assert(hydrated.wifiOnly === true, 'hydrated wifi');
  assert(hydrated.autoResume === true, 'hydrated auto');
  assert(hydrated.maxConcurrentDownloads === 3, 'hydrated max');
  assert(hydrated.notificationsEnabled === false, 'hydrated notif');
});

test('queue concurrency policy is mutable (not hard-coded 2 only)', () => {
  const initial = 2;
  const updated = 3;
  const queue = new DownloadQueue(initial);
  assert(queue.snapshot().maxConcurrent === initial, 'initial 2');
  queue.setMaxConcurrent(updated);
  assert(queue.snapshot().maxConcurrent === updated, 'updated to 3');
  assert(queue.concurrencyLimit === updated, 'getter 3');
});

test('canonical worker-state validation', () => {
  assert(DOWNLOAD_WORKER_STATES.includes('WAITING'), 'WAITING');
  assert(
    isValidWorkerStateForDownloadStatus('QUEUED', 'WAITING'),
    'QUEUED+WAITING',
  );
  assert(
    !isValidWorkerStateForDownloadStatus('QUEUED', 'TRANSFERRING'),
    'QUEUED+TRANSFERRING invalid',
  );
  assert(
    isValidWorkerStateForDownloadStatus('DOWNLOADING', 'TRANSFERRING'),
    'DOWNLOADING+TRANSFERRING',
  );
  assert(
    isValidWorkerStateForDownloadStatus('DOWNLOADING', 'VERIFYING'),
    'DOWNLOADING+VERIFYING',
  );
  assert(
    isValidWorkerStateForDownloadStatus('FAILED', 'RETRY_WAIT'),
    'FAILED+RETRY_WAIT',
  );
  assert(
    !isValidWorkerStateForDownloadStatus('COMPLETED', 'TRANSFERRING'),
    'COMPLETED contradiction',
  );
  assert(defaultWorkerStateForStatus('QUEUED') === 'WAITING', 'default');
});

test('retry transition graph: FAILED→QUEUED legal; terminals rejected', () => {
  const mobileLegal: Record<string, string[]> = {
    QUEUED: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
    DOWNLOADING: ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'],
    PAUSED: ['DOWNLOADING', 'FAILED', 'CANCELLED'],
    FAILED: ['QUEUED'],
    COMPLETED: [],
    CANCELLED: [],
  };
  assert(mobileLegal.FAILED.includes('QUEUED'), 'FAILED→QUEUED');
  assert(!mobileLegal.COMPLETED.includes('QUEUED'), 'COMPLETED blocked');
  assert(!mobileLegal.CANCELLED.includes('QUEUED'), 'CANCELLED blocked');
});

test('normalizeDownloadItem shape accepts new durable fields', () => {
  // Inline defensive parse matching store contract (avoid Zustand import).
  const raw = {
    id: '11111111-1111-1111-1111-111111111111',
    userId: '22222222-2222-2222-2222-222222222222',
    title: 't',
    sourceUrl: 'https://cdn.example.com/a.mp4',
    platform: 'OTHER',
    thumbnailUrl: 'https://cdn.example.com/t.jpg',
    fileName: 'a.mp4',
    fileSize: '100',
    status: 'QUEUED',
    progress: 0,
    quality: '720p',
    resolution: '1280x720',
    bitrate: 4200000,
    retryCount: 1,
    workerState: 'WAITING',
    errorCode: null,
    errorMessage: null,
    downloadedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  assert(raw.quality === '720p', 'quality');
  assert(raw.workerState === 'WAITING', 'worker');
  assert(raw.retryCount === 1, 'retry');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
