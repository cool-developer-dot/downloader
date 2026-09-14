/**
 * Week 7 Day 1 Phase 2 — quality presentation + download settings fixtures.
 * NO network. NO Metro.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-phase2-quality-settings.ts
 */

import type { MediaAnalysisResult } from '../src/api/types';
import {
  buildQualityMetaLine,
  buildQualitySecondaryLine,
  normalizeAnalysisToSelection,
  toCreateDownloadInput,
} from '../src/downloads/quality';
import {
  normalizeDownloadSettings,
  normalizeMaxConcurrentDownloads,
} from '../src/downloads/settings/normalize';
import { DEFAULT_DOWNLOAD_SETTINGS } from '../src/downloads/settings/types';

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

console.log('Week 7 Day 1 Phase 2 — quality + settings fixtures\n');

function main(): void {
test('single progressive option presentation', () => {
  const analysis: MediaAnalysisResult = {
    title: 'clip.mp4',
    sourceUrl: 'https://cdn.example.com/clip.mp4',
    finalUrl: 'https://cdn.example.com/clip.mp4',
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
        id: 'vq_prog',
        sourceUrl: 'https://cdn.example.com/clip.mp4',
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

  const selection = normalizeAnalysisToSelection(analysis);
  assert(selection.options.length === 1, 'one option');
  const option = selection.options[0]!;
  assert(option.label === 'Original Quality', 'label');
  assert(buildQualityMetaLine(option) === 'MP4', 'meta only container');
  assert(buildQualitySecondaryLine(option) === null, 'no tertiary junk');
});

test('multiple HLS options preserve order + presentation', () => {
  const analysis: MediaAnalysisResult = {
    title: 'Master',
    sourceUrl: 'https://cdn.example.com/master.m3u8',
    finalUrl: 'https://cdn.example.com/master.m3u8',
    thumbnailUrl: null,
    mediaType: 'stream',
    mimeType: 'application/vnd.apple.mpegurl',
    container: 'hls',
    duration: null,
    width: 1920,
    height: 1080,
    resolution: '1920x1080',
    bitrate: 5000000,
    fps: null,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
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
        bitrate: 5000000,
        averageBitrate: 4500000,
        videoBitrate: null,
        audioBitrate: null,
        codecs: 'avc1,mp4a',
        videoCodec: 'H.264',
        audioCodec: 'AAC',
        container: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        estimatedFileSize: 92000000,
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
        bitrate: 4200000,
        averageBitrate: null,
        videoBitrate: null,
        audioBitrate: null,
        codecs: 'avc1,mp4a',
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
        id: 'vq_480',
        sourceUrl: 'https://cdn.example.com/480/index.m3u8',
        streamType: 'HLS',
        label: '480p',
        resolution: '854x480',
        width: 854,
        height: 480,
        bitrate: 800000,
        averageBitrate: null,
        videoBitrate: null,
        audioBitrate: null,
        codecs: null,
        videoCodec: null,
        audioCodec: null,
        container: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        estimatedFileSize: null,
        frameRate: null,
        downloadable: true,
        unsupportedReason: null,
      },
    ],
  };

  const selection = normalizeAnalysisToSelection(analysis);
  assert(
    selection.options.map((o) => o.height).join(',') === '1080,720,480',
    'order preserved',
  );

  const hls720 = selection.options[1]!;
  assert(hls720.label === '720p', '720 label');
  assert(buildQualityMetaLine(hls720) === 'HLS · 4.2 Mbps', 'hls meta');
  assert(buildQualitySecondaryLine(hls720) === 'H.264 / AAC', 'hls tertiary');

  const hls1080 = selection.options[0]!;
  assert(buildQualityMetaLine(hls1080) === 'HLS · 4.5 Mbps', 'avg bitrate preferred');
  assert(
    buildQualitySecondaryLine(hls1080)?.includes('H.264 / AAC') === true,
    'codecs',
  );
  assert(
    buildQualitySecondaryLine(hls1080)?.includes('≈') === true,
    'estimated size marker',
  );
});

test('selected HLS variant URL reaches create mapping (not master)', () => {
  const analysis: MediaAnalysisResult = {
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
    bitrate: 4200000,
    fps: null,
    fileSize: null,
    platform: 'EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
    variants: [
      {
        id: 'vq_720',
        sourceUrl: 'https://cdn.example.com/720/index.m3u8',
        streamType: 'HLS',
        label: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        bitrate: 4200000,
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

  const selection = normalizeAnalysisToSelection(analysis);
  const option = selection.options[0]!;
  const payload = toCreateDownloadInput(selection, option);
  assert(payload != null, 'payload');
  assert(
    payload!.sourceUrl === 'https://cdn.example.com/720/index.m3u8',
    'variant url',
  );
  assert(!payload!.sourceUrl.includes('master.m3u8'), 'not master');
  assert(
    payload!.selectedQuality.sourceUrl === payload!.sourceUrl,
    'metadata url matches',
  );
  assert(payload!.selectedQuality.label === '720p', 'label preserved');
  assert(payload!.selectedQuality.streamType === 'HLS', 'streamType preserved');
  assert(payload!.selectedQuality.height === 720, 'height preserved');
  assert(payload!.selectedQuality.bitrate === 4200000, 'bitrate preserved');
});

test('defaults', () => {
  const defaults = { ...DEFAULT_DOWNLOAD_SETTINGS };
  assert(defaults.wifiOnly === true, 'wifi default preserves Week 6');
  assert(defaults.autoResume === true, 'autoResume default');
  assert(defaults.maxConcurrentDownloads === 2, 'concurrency default');
  assert(defaults.notificationsEnabled === true, 'notifications default');
  assert(
    JSON.stringify(defaults) === JSON.stringify(DEFAULT_DOWNLOAD_SETTINGS),
    'single defaults object',
  );
});

test('partial old settings migrate', () => {
  const normalized = normalizeDownloadSettings({ wifiOnly: false });
  assert(normalized.wifiOnly === false, 'kept');
  assert(normalized.autoResume === DEFAULT_DOWNLOAD_SETTINGS.autoResume, 'default auto');
  assert(
    normalized.maxConcurrentDownloads === 2,
    'default concurrency',
  );
  assert(
    normalized.notificationsEnabled ===
      DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
    'default notifications',
  );
});

test('corrupt concurrency normalizes to default', () => {
  for (const value of [999, 0, -5, Number.NaN, null, undefined, {}, []]) {
    assert(
      normalizeMaxConcurrentDownloads(value) === 2,
      `invalid ${String(value)} → 2`,
    );
  }
  assert(normalizeMaxConcurrentDownloads('4') === 4, 'numeric string 4');
  assert(normalizeMaxConcurrentDownloads(3) === 3, 'valid 3');
});

test('corrupt booleans stay conservative', () => {
  const normalized = normalizeDownloadSettings({
    wifiOnly: 'yes',
    autoResume: null,
    notificationsEnabled: 42,
    maxConcurrentDownloads: 999,
  });
  assert(normalized.wifiOnly === DEFAULT_DOWNLOAD_SETTINGS.wifiOnly, 'wifi fallback');
  assert(
    normalized.autoResume === DEFAULT_DOWNLOAD_SETTINGS.autoResume,
    'auto fallback',
  );
  assert(
    normalized.notificationsEnabled ===
      DEFAULT_DOWNLOAD_SETTINGS.notificationsEnabled,
    'notif fallback',
  );
  assert(normalized.maxConcurrentDownloads === 2, 'concurrency fallback');
});

test('engine-facing accessors resolve normalized settings', () => {
  const settings = normalizeDownloadSettings({
    wifiOnly: true,
    autoResume: false,
    maxConcurrentDownloads: 4,
    notificationsEnabled: false,
  });
  assert(settings.wifiOnly === true, 'wifi');
  assert(settings.autoResume === false, 'auto');
  assert(settings.maxConcurrentDownloads === 4, 'max');
  assert(settings.notificationsEnabled === false, 'notif');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
}

main();
