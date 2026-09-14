/**
 * Video Detection Engine — pure-logic verification.
 * Run: npx tsx scripts/verify-video-detection-engine.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyFalsePositive,
  dedupeUpsert,
  isFalsePositive,
} from '../src/media-detection/services';
import {
  isSupportedMediaUrl,
  mapDashRepresentationsToQualities,
  mapHlsVariantsToQualities,
  parseDashManifest,
  parseHlsManifest,
  parseProgressiveMediaUrl,
} from '../src/media-detection/parsers';
import { extractDetectedMedia } from '../src/media-detection/extractors';
import { labelFromHeight } from '../src/media-detection/quality';
import type { DetectedMedia } from '../src/media-detection/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, '../src/media-detection/fixtures');

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

function readFixture(name: string): string {
  return readFileSync(join(fixtures, name), 'utf8');
}

function baseMedia(partial: Partial<DetectedMedia> & Pick<DetectedMedia, 'id' | 'url'>): DetectedMedia {
  return {
    pageUrl: 'https://example.com/watch',
    sourceUrl: partial.url,
    finalUrl: partial.url,
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: null,
    height: null,
    resolution: null,
    aspectRatio: null,
    fps: null,
    estimatedFileSize: null,
    codec: null,
    audioCodec: null,
    bitrate: null,
    mimeType: null,
    extension: 'mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'DIRECT',
    isLive: false,
    isDrm: false,
    playlistType: null,
    streamProtocol: null,
    websiteSource: null,
    detectionSource: 'network_request',
    sourceDetector: 'network_request',
    detectedAt: Date.now(),
    confidence: 0.7,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: null,
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

// --- DIRECT ---
{
  const mp4 = parseProgressiveMediaUrl({
    url: 'https://cdn.example.com/video/clip.mp4',
    pageUrl: 'https://example.com/page',
    detectionSource: 'network_request',
  });
  assert(mp4 != null && mp4.extension === 'mp4', 'direct .mp4 candidate');

  const extless = parseProgressiveMediaUrl({
    url: 'https://cdn.example.com/media?id=123',
    pageUrl: 'https://example.com/page',
    mimeType: 'video/mp4',
    detectionSource: 'mime_probe',
  });
  assert(extless != null && extless.mimeType === 'video/mp4', 'extensionless video/mp4');

  const misleading = parseProgressiveMediaUrl({
    url: 'https://cdn.example.com/assets/app.js',
    pageUrl: 'https://example.com/page',
    detectionSource: 'network_request',
  });
  assert(misleading == null, 'misleading .js rejected');

  assert(
    isSupportedMediaUrl('https://cdn.example.com/x', 'video/webm'),
    'MIME-only support',
  );
}

// --- FILTERING ---
{
  assert(
    isFalsePositive({ url: 'https://cdn.example.com/a.png' }),
    'image false positive',
  );
  assert(
    isFalsePositive({
      url: 'https://www.google-analytics.com/collect?v=1',
    }),
    'analytics false positive',
  );
  assert(
    isFalsePositive({ url: 'https://cdn.example.com/bundle.js' }),
    'js false positive',
  );
  assert(
    isFalsePositive({ url: 'https://cdn.example.com/theme.css' }),
    'css false positive',
  );
  assert(
    isFalsePositive({ url: 'https://cdn.example.com/subs.vtt' }),
    'subtitle false positive',
  );
  assert(
    classifyFalsePositive({
      url: 'https://cdn.example.com/hls/seg000.ts',
    }) === 'hls_segment' ||
      classifyFalsePositive({
        url: 'https://cdn.example.com/hls/seg000.ts',
      }) === 'weak_extension_alone',
    'random .ts segment suppressed',
  );
  assert(
    isFalsePositive({ url: 'blob:https://example.com/abc' }),
    'blob URL not downloadable',
  );
  assert(
    !isSupportedMediaUrl('https://cdn.example.com/seg001.ts'),
    '.ts alone not supported',
  );
}

// --- HLS ---
{
  const master = parseHlsManifest(
    readFixture('hls-master.m3u8'),
    'https://cdn.example.com/master.m3u8',
  );
  assert(master != null && master.isMaster, 'HLS master parsed');
  assert(master!.variants.length === 4, 'HLS four variants');
  assert(
    master!.variants.some((v) => v.height === 1080),
    'HLS 1080p variant',
  );
  assert(
    master!.variants.every((v) => v.uri.startsWith('https://cdn.example.com/')),
    'HLS relative URIs resolved',
  );
  assert(
    master!.variants[0]?.audioGroup === 'aac',
    'HLS audio group extracted',
  );
  assert(
    master!.variants[0]?.frameRate === 30,
    'HLS frame rate extracted',
  );

  const qualities = mapHlsVariantsToQualities('media1', master!.variants);
  assert(qualities.length === 4, 'HLS qualities mapped');
  assert(
    labelFromHeight(1080) === '1080p' &&
      labelFromHeight(720) === '720p' &&
      labelFromHeight(480) === '480p' &&
      labelFromHeight(360) === '360p',
    'quality labels normalized',
  );

  const mediaPl = parseHlsManifest(
    readFixture('hls-media.m3u8'),
    'https://cdn.example.com/360p.m3u8',
  );
  assert(mediaPl != null && mediaPl.isMedia, 'HLS media playlist');
  assert(mediaPl!.segmentUris.length === 3, 'HLS segments collected');
  assert(
    mediaPl!.segmentUris.every((u) => u.includes('.ts')),
    'HLS segments are .ts under parent',
  );
  assert(mediaPl!.variants.length === 0, 'media playlist has no variants');

  const invalid = parseHlsManifest(
    readFixture('hls-invalid.m3u8'),
    'https://cdn.example.com/bad.m3u8',
  );
  assert(invalid == null, 'invalid M3U8 rejected');
}

// --- DASH ---
{
  const dash = parseDashManifest(
    readFixture('dash-valid.mpd'),
    'https://cdn.example.com/manifest.mpd',
  );
  assert(dash != null && dash.isValid, 'DASH MPD valid');
  assert(dash!.videoRepresentations.length === 3, 'DASH video reps');
  assert(dash!.audioRepresentations.length === 1, 'DASH audio reps');
  assert(dash!.hasSeparateAudio === true, 'DASH separate audio/video');
  assert(
    dash!.videoRepresentations.some((r) => r.height === 1080),
    'DASH 1080p representation',
  );

  const q = mapDashRepresentationsToQualities('dash1', dash!);
  assert(q.length === 3, 'DASH qualities from video only');
  assert(
    q.every((item) => item.hasVideo && item.hasAudio === false),
    'DASH video-only flags when separate audio',
  );

  const bad = parseDashManifest(
    readFixture('dash-invalid.mpd'),
    'https://cdn.example.com/bad.mpd',
  );
  assert(bad == null, 'invalid DASH XML rejected');
}

// --- DEDUPE ---
{
  const a = baseMedia({
    id: 'a',
    url: 'https://cdn.example.com/v.mp4?cb=1',
    sourceUrl: 'https://cdn.example.com/v.mp4',
    finalUrl: 'https://cdn.example.com/v.mp4?cb=1',
  });
  const b = baseMedia({
    id: 'b',
    url: 'https://cdn.example.com/v.mp4?cb=2',
    sourceUrl: 'https://cdn.example.com/v.mp4',
    finalUrl: 'https://cdn.example.com/v.mp4?cb=2',
    confidence: 0.9,
    width: 1920,
    height: 1080,
    detectionSource: 'dom_video',
    sourceDetector: 'dom_video',
  });
  const first = dedupeUpsert([], a, 80);
  assert(first.inserted, 'dedupe insert');
  const second = dedupeUpsert(first.items, b, 80);
  assert(second.updated && !second.inserted, 'dedupe collapses duplicates');
  assert(second.items.length === 1, 'one logical item');
  assert(second.items[0]!.confidence === 0.9, 'higher confidence kept');
}

// --- DETECTED MODEL ---
{
  const candidate = parseProgressiveMediaUrl({
    url: 'https://cdn.example.com/clip.webm',
    pageUrl: 'https://example.com/p',
    mimeType: 'video/webm',
    detectionSource: 'js_fetch',
    width: 1280,
    height: 720,
  });
  assert(candidate != null, 'webm candidate');
  const detected = extractDetectedMedia({
    ...candidate!,
    width: 1280,
    height: 720,
  });
  assert(detected != null, 'detected model built');
  assert(detected!.streamType === 'DIRECT', 'streamType DIRECT');
  assert(detected!.sourceUrl.length > 0, 'sourceUrl set');
  assert(detected!.finalUrl.length > 0, 'finalUrl set');
  assert(typeof detected!.downloadable === 'boolean', 'downloadable set');
  assert(detected!.confidence >= 0.5, 'confidence above accept');
}

console.log(`\nVideo detection verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
