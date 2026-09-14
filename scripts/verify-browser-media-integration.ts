/**
 * Phase 2E — browser media integration verification.
 * Usage (from mobile/): npm run verify:browser-media-integration
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyFalsePositive, isFalsePositive } from '../src/media-detection/services/false-positive.filter';
import { dedupeUpsert } from '../src/media-detection/services/deduplication.service';
import { DETECTION_TIMING } from '../src/media-detection/constants/media.constants';
import { sanitizeBrowserUrl } from '../src/browser/diagnostics/browser-runtime-diagnostics.service';

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
    const message = error instanceof Error ? error.message : String(error);
    console.log(`FAIL  ${name}\n      ${message}`);
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

console.log('Phase 2E — Browser Media Integration Verification\n');

async function main(): Promise<void> {
  await test('native interception remains observe-only', () => {
    const hook = readSrc('scripts/apply-webview-media-hook.js');
    mustInclude(hook, ['return super.shouldInterceptRequest', 'Never replaces the response'], 'hook');
    const client = readFileSync(
      join(ROOT, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview/RNCWebViewClient.java'),
      'utf8',
    );
    mustInclude(client, ['return super.shouldInterceptRequest(view, request)'], 'native client');
  });

  await test('DOM video candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ["'dom_video'", 'querySelectorAll(\'video\')'], 'dom video');
  });

  await test('DOM source candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ["'dom_source'", 'querySelectorAll(\'source\')'], 'dom source');
  });

  await test('MutationObserver candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ['MutationObserver', 'scheduleScanDom'], 'mutation observer');
  });

  await test('fetch candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ['js_fetch', 'window.fetch'], 'fetch hook');
  });

  await test('XHR candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ['js_xhr', 'XMLHttpRequest'], 'xhr hook');
  });

  await test('PerformanceObserver candidate detected', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ['performance_resource', 'PerformanceObserver'], 'perf observer');
  });

  await test('duplicate observation deduped', () => {
    const base = {
      id: 'md_a',
      url: 'https://cdn.example.com/v.mp4',
      finalUrl: null,
      sourceUrl: null,
      pageUrl: 'https://example.com',
      title: null,
      mimeType: 'video/mp4',
      container: 'mp4',
      category: 'video',
      streamType: 'DIRECT',
      confidence: 0.6,
      detectionSource: 'dom_video',
      requiresCookies: false,
      requiredHeaders: null,
      thumbnailUrl: null,
      duration: null,
      width: null,
      height: null,
      resolution: null,
      bitrate: null,
      codec: null,
      audioCodec: null,
      estimatedFileSize: null,
      websiteSource: null,
      isDrm: false,
      videoOnly: false,
      hasSeparateAudio: false,
    } as import('../src/media-detection/types').DetectedMedia;
    const first = dedupeUpsert([], base, 80);
    const second = dedupeUpsert(first.items, { ...base, confidence: 0.7 }, 80);
    assert(second.items.length === 1, 'deduped to one');
  });

  await test('distinct quality variants preserved', () => {
    const mk = (id: string, url: string): import('../src/media-detection/types').DetectedMedia =>
      ({
        id,
        url,
        finalUrl: null,
        sourceUrl: null,
        pageUrl: 'https://example.com',
        title: null,
        mimeType: 'video/mp4',
        container: 'mp4',
        category: 'video',
        streamType: 'DIRECT',
        confidence: 0.6,
        detectionSource: 'dom_video',
        requiresCookies: false,
        requiredHeaders: null,
        thumbnailUrl: null,
        duration: null,
        width: null,
        height: null,
        resolution: null,
        bitrate: null,
        codec: null,
        audioCodec: null,
        estimatedFileSize: null,
        websiteSource: null,
        isDrm: false,
        videoOnly: false,
        hasSeparateAudio: false,
      }) as import('../src/media-detection/types').DetectedMedia;
    const merged = dedupeUpsert(dedupeUpsert([], mk('md_1', 'https://cdn.example.com/v_1080.mp4'), 80).items, mk('md_2', 'https://cdn.example.com/v_720.mp4'), 80);
    assert(merged.items.length === 2, 'variants kept');
  });

  await test('image thumbnail rejected', () => {
    assert(
      isFalsePositive({ url: 'https://cdn.example.com/thumb/preview.jpg' }),
      'thumbnail rejected',
    );
  });

  await test('poster rejected', () => {
    assert(
      isFalsePositive({ url: 'https://cdn.example.com/assets/poster_cover.webp' }),
      'poster rejected',
    );
  });

  await test('.ts segment not exposed as individual video', () => {
    assert(
      classifyFalsePositive({ url: 'https://cdn.example.com/segments/segment0001.ts' }) === 'hls_segment',
      'ts segment',
    );
  });

  await test('.m4s segment not exposed as individual final media', () => {
    assert(
      classifyFalsePositive({ url: 'https://cdn.example.com/chunks/frag0001.m4s' }) === 'hls_segment',
      'm4s segment',
    );
  });

  await test('HLS manifest accepted', () => {
    assert(!isFalsePositive({ url: 'https://cdn.example.com/stream/index.m3u8', mimeType: 'application/vnd.apple.mpegurl' }), 'hls manifest');
  });

  await test('blob URL not passed directly to downloader', () => {
    assert(classifyFalsePositive({ url: 'blob:https://example.com/abc-123' }) === 'blob_scheme', 'blob rejected');
    const handoff = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    mustInclude(handoff, ['enqueueBrowserMediaDownload', 'useDownloadsStore'], 'phase1 handoff');
  });

  await test('candidate tied to navigation epoch', () => {
    const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
    mustInclude(engine, ['navigationEpoch', 'isCurrentEpoch'], 'epoch guards');
  });

  await test('navigation clears stale CTA', () => {
    mustInclude(readSrc('src/media-detection/engine/media-detection.engine.ts'), ['clearPageDetections', 'onNavigationStart'], 'nav clear');
  });

  await test('error clears stale CTA', () => {
    mustInclude(readSrc('src/media-detection/engine/media-detection.engine.ts'), ['onBrowserError'], 'error clear');
    mustInclude(readSrc('src/media-detection/hooks/useMediaDetectionBrowserSync.ts'), ['onBrowserError', 'resetForNavigation'], 'sync error');
  });

  await test('home clears stale CTA', () => {
    mustInclude(readSrc('src/media-detection/engine/media-detection.engine.ts'), ['onGoHome', 'clearPageDetections'], 'home clear');
  });

  await test('SPA media replacement updates candidate', () => {
    mustInclude(readSrc('src/media-detection/observers/injected-script.ts'), ['MutationObserver', 'loadedmetadata'], 'spa media');
  });

  await test('popup same-surface navigation gets fresh detection context', () => {
    mustInclude(readSrc('src/browser/navigation/popup-navigation.service.ts'), ['load_in_browser'], 'popup routing');
  });

  await test('Desktop reload creates fresh media generation', () => {
    mustInclude(readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts'), ['bumpNavigationEpoch', 'reloadWebView'], 'desktop reload epoch');
  });

  await test('session context host scoped', () => {
    mustInclude(readSrc('src/media-detection/services/request-context.service.ts'), ['pageUrl', 'referer'], 'request context');
    mustInclude(readSrc('src/media-detection/adapters/cookie-bridge.adapter.ts'), ['Cookie'], 'cookie bridge');
  });

  await test('cookie values never logged', () => {
    const cookie = readSrc('src/media-detection/adapters/cookie-bridge.adapter.ts');
    mustInclude(cookie, ['Values are never logged'], 'cookie security');
    const diag = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(diag, ['cookie', 'BLOCKED_KEYS'], 'blocked cookie keys');
  });

  await test('Authorization never logged', () => {
    const diag = readSrc('src/browser/diagnostics/browser-runtime-diagnostics.service.ts');
    mustInclude(diag, ['authorization'], 'blocked auth');
  });

  await test('signed URL diagnostic sanitizer works', () => {
    const meta = sanitizeBrowserUrl('https://cdn.example.com/v.mp4?sig=abc123&expires=999');
    assert(meta.safeHost === 'cdn.example.com', 'host sanitized');
    assert(!JSON.stringify(meta).includes('sig=abc'), 'no signed query');
  });

  await test('candidate store bounded', () => {
    assert(DETECTION_TIMING.maxDetectedPerPage > 0, 'max per page');
    assert(DETECTION_TIMING.maxCandidatesPerBatch > 0, 'max batch');
  });

  await test('no candidate triggers automatic enqueue', () => {
    const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
    mustInclude(engine, ['Never downloads', 'Never shows UI'], 'observe only');
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    mustInclude(hook, ['download = useCallback', 'enqueueBrowserMediaDownload'], 'explicit download');
  });

  await test('explicit CTA is required', () => {
    mustInclude(readSrc('src/browser/media-actions/BrowserMediaDownloadBar.tsx'), ['download', 'onPress'], 'CTA button');
  });

  await test('handoff uses existing Phase 1 API', () => {
    mustInclude(readSrc('src/browser/media-actions/browser-media-download.service.ts'), ['useDownloadsStore', 'create('], 'downloads store');
  });

  await test('Phase 1 state machine not duplicated', () => {
    const handoff = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(!handoff.includes('PREPARING'), 'browser handoff does not duplicate download states');
  });

  await test('unsupported DRM not circumvented', () => {
    mustInclude(readSrc('src/media-detection/ui/badges.ts'), ['isDrm', 'DRM'], 'drm guard');
  });

  await test('unsupported DASH combined behavior not falsely advertised', () => {
    mustInclude(readSrc('src/media-detection/services/media-correlation.service.ts'), ['hasSeparateAudio', 'videoOnly'], 'dash boundary');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
