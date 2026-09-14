/**
 * Week 7 Day 1 Phase 1 — mobile canonical quality normalization fixtures.
 * NO network. NO Metro.
 *
 * Usage (from mobile/):
 *   npx tsx scripts/verify-quality-normalize.ts
 */

import type { MediaAnalysisResult } from '../src/api/types';
import {
  buildQualityLabel,
  normalizeAnalysisToSelection,
  sortQualityOptions,
} from '../src/downloads/quality/normalize';

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name: string, fn: () => void): Promise<void> {
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

console.log('Week 7 Day 1 Phase 1 — mobile quality normalize fixtures\n');

async function main(): Promise<void> {
await test('Analyze variants → DownloadQualityOption[] mapping', () => {
  const analysis: MediaAnalysisResult = {
    title: 'Demo',
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
    fps: 30,
    fileSize: null,
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
    variants: [
      {
        id: 'vq_1080',
        sourceUrl: 'https://cdn.example.com/1080.m3u8',
        streamType: 'HLS',
        label: '1080p',
        resolution: '1920x1080',
        width: 1920,
        height: 1080,
        bitrate: 5000000,
        averageBitrate: 4500000,
        videoBitrate: null,
        audioBitrate: null,
        codecs: 'avc1.64001f,mp4a.40.2',
        videoCodec: 'H.264',
        audioCodec: 'AAC',
        container: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        estimatedFileSize: null,
        frameRate: 30,
        downloadable: true,
        unsupportedReason: null,
      },
      {
        id: 'vq_720',
        sourceUrl: 'https://cdn.example.com/720.m3u8',
        streamType: 'HLS',
        label: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        bitrate: 1400000,
        averageBitrate: 1200000,
        videoBitrate: null,
        audioBitrate: null,
        codecs: 'avc1.64001f,mp4a.40.2',
        videoCodec: 'H.264',
        audioCodec: 'AAC',
        container: 'hls',
        mimeType: 'application/vnd.apple.mpegurl',
        estimatedFileSize: null,
        frameRate: 30,
        downloadable: true,
        unsupportedReason: null,
      },
    ],
  };

  const selection = normalizeAnalysisToSelection(analysis);
  assert(selection.options.length === 2, 'two options');
  assert(selection.options[0]?.label === '1080p', 'label');
  assert(selection.options[0]?.streamType === 'HLS', 'streamType');
  assert(selection.options[0]?.isHls === true, 'isHls');
  assert(selection.options[0]?.isProgressive === false, 'not progressive');
  assert(selection.options[0]?.sourceUrl.endsWith('/1080.m3u8'), 'sourceUrl');
  assert(selection.options[0]?.resolution === '1920x1080', 'resolution');
  assert(selection.options[0]?.bitrate === 5000000, 'bitrate');
  assert(selection.options[0]?.averageBitrate === 4500000, 'avg bitrate');
  assert(selection.options[0]?.videoCodec === 'H.264', 'video codec');
  assert(selection.options[0]?.audioCodec === 'AAC', 'audio codec');
  assert(selection.options[0]?.container === 'hls', 'container');
  assert(selection.options[0]?.estimatedFileSize === null, 'size null');
  assert(selection.options[0]?.frameRate === 30, 'fps');
});

await test('progressive Analyze → Original Quality progressive option', () => {
  const analysis: MediaAnalysisResult = {
    title: 'clip.mp4',
    sourceUrl: 'https://cdn.example.com/clip.mp4?sig=1',
    finalUrl: 'https://cdn.example.com/clip.mp4?sig=1',
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
    fileSize: '2048',
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
    variants: [
      {
        id: 'vq_prog',
        sourceUrl: 'https://cdn.example.com/clip.mp4?sig=1',
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
        estimatedFileSize: 2048,
        frameRate: null,
        downloadable: true,
        unsupportedReason: null,
      },
    ],
  };

  const selection = normalizeAnalysisToSelection(analysis);
  assert(selection.options.length === 1, 'one');
  const option = selection.options[0]!;
  assert(option.label === 'Original Quality', 'label');
  assert(option.streamType === 'PROGRESSIVE', 'progressive');
  assert(option.isProgressive === true, 'flag');
  assert(option.isHls === false, 'not hls');
  assert(option.fileSize === '2048', 'fileSize');
  assert(option.estimatedFileSize === 2048, 'estimated');
  assert(option.height === null, 'no fake height');
  assert(option.sourceUrl.includes('sig=1'), 'query kept');
});

await test('legacy Analyze without variants still maps one option', () => {
  const analysis: MediaAnalysisResult = {
    title: null,
    sourceUrl: 'https://cdn.example.com/a.mp4',
    finalUrl: 'https://cdn.example.com/a.mp4',
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
    fileSize: '100',
    platform: 'CDN_EXAMPLE',
    downloadable: true,
    unsupportedReason: null,
  };

  const selection = normalizeAnalysisToSelection(analysis);
  assert(selection.options.length === 1, 'legacy one option');
  assert(selection.options[0]?.streamType === 'PROGRESSIVE', 'progressive');
  assert(selection.options[0]?.label === 'Original Quality', 'label');
});

await test('label + ordering helpers', () => {
  assert(buildQualityLabel({ height: 720 }) === '720p', '720p');
  assert(buildQualityLabel({}) === 'Original Quality', 'original');

  const sorted = sortQualityOptions([
    {
      id: 'a',
      label: '480p',
      sourceUrl: 'https://cdn.example.com/480.m3u8',
      resolution: '854x480',
      width: 854,
      height: 480,
      bitrate: 800000,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codec: null,
      videoCodec: null,
      audioCodec: null,
      rawCodec: null,
      container: 'hls',
      mimeType: null,
      fileSize: null,
      estimatedFileSize: null,
      fps: null,
      frameRate: null,
      streamType: 'HLS',
      isHls: true,
      isProgressive: false,
      isAudioOnly: false,
      mediaType: 'stream',
      hasAudio: null,
      hasVideo: true,
      downloadable: true,
      unavailableReason: null,
    },
    {
      id: 'b',
      label: '1080p',
      sourceUrl: 'https://cdn.example.com/1080.m3u8',
      resolution: '1920x1080',
      width: 1920,
      height: 1080,
      bitrate: 5000000,
      averageBitrate: null,
      videoBitrate: null,
      audioBitrate: null,
      codec: null,
      videoCodec: null,
      audioCodec: null,
      rawCodec: null,
      container: 'hls',
      mimeType: null,
      fileSize: null,
      estimatedFileSize: null,
      fps: null,
      frameRate: null,
      streamType: 'HLS',
      isHls: true,
      isProgressive: false,
      isAudioOnly: false,
      mediaType: 'stream',
      hasAudio: null,
      hasVideo: true,
      downloadable: true,
      unavailableReason: null,
    },
  ]);

  assert(sorted[0]?.height === 1080, '1080 first');
  assert(sorted[1]?.height === 480, '480 second');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
