/**
 * Phase 5A — General website media discovery / ownership verifier.
 * Usage (from mobile/): npm run verify:phase5a-general-media-discovery
 *
 * Deterministic TypeScript checks only — no Maestro / Appium / Python.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  correlateGeneralCandidate,
  didGeneralMediaResourceOwnershipChange,
  generalPageMediaContextStore,
  isBlobOnlyResource,
  isPosterOrImageResource,
  isSegmentResource,
  isThumbnailResource,
  selectCurrentGeneralMedia,
  type GeneralPageMediaContext,
} from '../src/media-detection/general-media';
import { DETECTION_TIMING } from '../src/media-detection/constants/media.constants';
import type { DetectedMedia } from '../src/media-detection/types';

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

function makeMedia(
  partial: Partial<DetectedMedia> & { id: string; url: string },
): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: 'https://example.com/watch/abc',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: 1280,
    height: 720,
    resolution: '720p',
    aspectRatio: 16 / 9,
    fps: null,
    estimatedFileSize: 5_000_000,
    codec: null,
    audioCodec: null,
    bitrate: null,
    mimeType: 'video/mp4',
    extension: 'mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'DIRECT',
    isLive: false,
    isDrm: false,
    playlistType: null,
    streamProtocol: null,
    websiteSource: 'example.com',
    detectionSource: 'dom_video',
    sourceDetector: 'dom_video',
    detectedAt: Date.now(),
    confidence: 0.7,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'GENERIC',
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

function makeContext(
  overrides: Partial<GeneralPageMediaContext> = {},
): GeneralPageMediaContext {
  return {
    tabId: 'tab-a',
    navigationEpoch: 1,
    pageGeneration: 10,
    pageUrl: 'https://example.com/watch/abc',
    activeMediaElementIdentity: 'v-main',
    activeMediaResourceIdentity: 'cdn.example.com/main.mp4',
    currentMediaIdentity: 'v-main:cdn.example.com/main.mp4',
    activeVideoCurrentSrc: 'https://cdn.example.com/main.mp4?sig=abc',
    activeVideoIsBlob: false,
    activeVideoIntersectionRatio: 0.9,
    activeVideoPaused: false,
    activeVideoRecentlyPlayed: true,
    activeVideoMuted: false,
    activeVideoWidth: 1280,
    activeVideoHeight: 720,
    explicitAdMarker: false,
    userInteractionSignal: true,
    observedAt: Date.now(),
    ...overrides,
  };
}

console.log('Phase 5A — General Media Discovery Verification\n');

async function main(): Promise<void> {
  generalPageMediaContextStore.clearAll();

  await test('1. visible playing <video> becomes STRONG', () => {
    const ctx = makeContext();
    const media = makeMedia({
      id: 'main',
      url: 'https://cdn.example.com/main.mp4',
    });
    const result = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'STRONG', `expected STRONG got ${result.confidence}`);
  });

  await test('2. hidden/offscreen preload cannot replace STRONG current media', () => {
    const ctx = makeContext();
    const main = makeMedia({
      id: 'main',
      url: 'https://cdn.example.com/main.mp4',
      estimatedFileSize: 1_000_000,
    });
    const preload = makeMedia({
      id: 'preload',
      url: 'https://cdn.example.com/next-huge.mp4',
      estimatedFileSize: 50_000_000,
      width: 3840,
      height: 2160,
      detectionSource: 'native_network',
      confidence: 0.95,
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [preload, main],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id === 'main', `main should win, got ${selected.media?.id}`);
    assert(selected.group.confidence === 'STRONG', 'STRONG ownership');
    const preloadCorr = correlateGeneralCandidate(preload, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(
      preloadCorr.confidence === 'REJECTED' ||
        preloadCorr.rejectionReason === 'OFFSCREEN_PRELOAD',
      'preload suppressed',
    );
  });

  await test('3. poster image rejected', () => {
    const ctx = makeContext();
    const poster = makeMedia({
      id: 'poster',
      url: 'https://cdn.example.com/video-poster.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      category: 'video',
    });
    assert(isPosterOrImageResource(poster), 'poster helper');
    const result = correlateGeneralCandidate(poster, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'rejected');
    assert(
      result.rejectionReason === 'POSTER_ONLY' ||
        result.rejectionReason === 'IMAGE_RESOURCE',
      `poster reason got ${result.rejectionReason}`,
    );
  });

  await test('4. thumbnail image rejected', () => {
    const ctx = makeContext();
    const thumb = makeMedia({
      id: 'thumb',
      url: 'https://cdn.example.com/thumbnails/preview.webp',
      mimeType: 'image/webp',
      extension: 'webp',
    });
    assert(isThumbnailResource(thumb) || isPosterOrImageResource(thumb), 'thumb helper');
    const result = correlateGeneralCandidate(thumb, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'thumb rejected');
  });

  await test('5. .ts rejected as final', () => {
    const seg = makeMedia({
      id: 'ts',
      url: 'https://cdn.example.com/hls/segment001.ts',
      extension: 'ts',
      mimeType: 'video/mp2t',
    });
    assert(isSegmentResource(seg), 'ts segment');
    const result = correlateGeneralCandidate(seg, {
      context: makeContext(),
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: 'https://example.com/watch/abc',
    });
    assert(result.confidence === 'REJECTED', 'ts rejected');
    assert(result.rejectionReason === 'SEGMENT_RESOURCE', 'segment reason');
  });

  await test('6. .m4s rejected as final', () => {
    const seg = makeMedia({
      id: 'm4s',
      url: 'https://cdn.example.com/dash/chunk-1.m4s',
      extension: 'm4s',
      mimeType: 'video/iso.segment',
    });
    assert(isSegmentResource(seg), 'm4s segment');
    const result = correlateGeneralCandidate(seg, {
      context: makeContext(),
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: 'https://example.com/watch/abc',
    });
    assert(result.confidence === 'REJECTED', 'm4s rejected');
    assert(result.rejectionReason === 'SEGMENT_RESOURCE', 'segment reason');
  });

  await test('7. blob accepted as clue only', () => {
    const blob = makeMedia({
      id: 'blob',
      url: 'blob:https://example.com/uuid-1',
      extension: null,
      mimeType: 'video/mp4',
    });
    assert(isBlobOnlyResource(blob), 'blob helper');
    const blobResult = correlateGeneralCandidate(blob, {
      context: makeContext({ activeVideoIsBlob: true }),
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: 'https://example.com/watch/abc',
    });
    assert(blobResult.confidence === 'REJECTED', 'blob never final');
    assert(blobResult.rejectionReason === 'BLOB_ONLY', 'blob reason');

    const network = makeMedia({
      id: 'net',
      url: 'https://cdn.example.com/underlying.mp4',
    });
    const ctx = makeContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://example.com/uuid-1',
      activeMediaResourceIdentity: null,
    });
    const netResult = correlateGeneralCandidate(network, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
      msePlaybackActive: true,
    });
    assert(
      netResult.confidence === 'MEDIUM' || netResult.confidence === 'STRONG',
      `blob clue should lift network, got ${netResult.confidence}`,
    );
  });

  await test('8. background tiny loop does not beat main player', () => {
    const ctx = makeContext({
      activeMediaElementIdentity: 'v-main',
      activeVideoCurrentSrc: 'https://cdn.example.com/main.mp4',
      activeVideoWidth: 1280,
      activeVideoHeight: 720,
      activeVideoMuted: false,
      userInteractionSignal: true,
    });
    const main = makeMedia({
      id: 'main',
      url: 'https://cdn.example.com/main.mp4',
    });
    const tiny = makeMedia({
      id: 'tiny',
      url: 'https://cdn.example.com/bg-loop.mp4',
      width: 120,
      height: 80,
      estimatedFileSize: 200_000,
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [tiny, main],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id === 'main', 'main beats tiny loop');

    const tinyActive = makeContext({
      activeVideoCurrentSrc: 'https://cdn.example.com/bg-loop.mp4',
      activeVideoWidth: 120,
      activeVideoHeight: 80,
      activeVideoMuted: true,
      userInteractionSignal: false,
      activeVideoIntersectionRatio: 0.2,
    });
    const tinyCorr = correlateGeneralCandidate(tiny, {
      context: tinyActive,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: tinyActive.pageUrl,
    });
    assert(
      tinyCorr.confidence === 'WEAK' || tinyCorr.confidence === 'REJECTED',
      `tiny must not be STRONG, got ${tinyCorr.confidence}`,
    );
  });

  await test('9. explicit ad marker penalizes/rejects ad ownership', () => {
    const ctx = makeContext({ explicitAdMarker: true });
    const ad = makeMedia({
      id: 'ad',
      url: 'https://cdn.example.com/main.mp4',
      estimatedFileSize: 80_000_000,
    });
    const result = correlateGeneralCandidate(ad, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'ad rejected');
    assert(result.rejectionReason === 'ADVERTISEMENT', 'ad reason');
  });

  await test('10. no hardcoded giant ad-domain list', () => {
    const corr = readSrc(
      'src/media-detection/general-media/general-correlation.service.ts',
    );
    assert(!/doubleclick\.net/.test(corr), 'no doubleclick list');
    assert(!/googlesyndication/.test(corr), 'no adsense list');
    assert(!/AD_HOSTS\s*=\s*\[/.test(corr), 'no AD_HOSTS array');
    assert(corr.includes('explicitAdMarker'), 'uses structural ad marker');
  });

  await test('11. same player source changes → generation update', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const ctx = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/watch/abc',
      navigationEpoch: 2,
    });
    assert(ctx != null, 'context created');
    const g1 = ctx!.pageGeneration;

    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 2,
      evidence: {
        pageUrl: 'https://example.com/watch/abc',
        elementIdentity: 'player-1',
        currentSrc: 'https://cdn.example.com/video-a.mp4',
        src: 'https://cdn.example.com/video-a.mp4',
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 0.9,
        viewportCenterDistance: 10,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: null,
        observedAt: Date.now(),
      },
    });

    const afterB = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 2,
      evidence: {
        pageUrl: 'https://example.com/watch/abc',
        elementIdentity: 'player-1',
        currentSrc: 'https://cdn.example.com/video-b.mp4',
        src: 'https://cdn.example.com/video-b.mp4',
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 0.9,
        viewportCenterDistance: 10,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: null,
        observedAt: Date.now(),
      },
    });
    assert(afterB != null, 'after B');
    assert(
      afterB!.pageGeneration > g1,
      `generation should bump (${g1} → ${afterB!.pageGeneration})`,
    );
    assert(
      didGeneralMediaResourceOwnershipChange(
        'https://cdn.example.com/video-a.mp4?tok=1',
        'https://cdn.example.com/video-a.mp4?tok=2',
      ) === false,
      'signed refresh is not ownership change',
    );
  });

  await test('12. stale old-generation result ignored', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/a',
      navigationEpoch: 5,
    });
    assert(
      generalPageMediaContextStore.isStaleGeneration('tab-a', 5, 0) === true,
      'wrong generation stale',
    );
    const cur = generalPageMediaContextStore.get('tab-a');
    assert(cur != null, 'has context');
    assert(
      generalPageMediaContextStore.isStaleGeneration(
        'tab-a',
        5,
        cur!.pageGeneration,
      ) === false,
      'current generation ok',
    );
    assert(
      generalPageMediaContextStore.isStaleGeneration('tab-a', 4, cur!.pageGeneration) ===
        true,
      'old epoch stale',
    );

    const result = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({ id: 'x', url: 'https://cdn.example.com/main.mp4' }),
      ],
      context: makeContext({ navigationEpoch: 9, pageGeneration: 1 }),
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: 'https://example.com/watch/abc',
    });
    assert(result.media == null, 'stale nav yields no media');
  });

  await test('13. SPA pushState media transition', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const a = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/article/a',
      navigationEpoch: 3,
    });
    const b = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/article/b',
      navigationEpoch: 3,
    });
    assert(a != null && b != null, 'contexts');
    assert(b!.pageGeneration > a!.pageGeneration, 'pushState bumps generation');
    assert(b!.activeMediaElementIdentity == null, 'ownership cleared');
  });

  await test('14. SPA replaceState media transition', () => {
    // replaceState with path change still bumps via syncFromPageUrl path identity.
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const a = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/player?v=1',
      navigationEpoch: 4,
    });
    const b = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/player?v=2',
      navigationEpoch: 4,
    });
    assert(a != null && b != null, 'contexts');
    // Query-only may share path identity — recycled player evidence still bumps.
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 4,
      evidence: {
        pageUrl: 'https://example.com/player?v=2',
        elementIdentity: 'p1',
        currentSrc: 'https://cdn.example.com/v1.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 800,
        videoHeight: 450,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 1,
        viewportCenterDistance: 0,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: null,
        observedAt: Date.now(),
      },
    });
    const after = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 4,
      evidence: {
        pageUrl: 'https://example.com/player?v=2',
        elementIdentity: 'p1',
        currentSrc: 'https://cdn.example.com/v2.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 800,
        videoHeight: 450,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 1,
        viewportCenterDistance: 0,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: null,
        observedAt: Date.now(),
      },
    });
    assert(
      (after?.pageGeneration ?? 0) > (b?.pageGeneration ?? 0),
      'replaceState player source bumps generation',
    );
  });

  await test('15. back/popstate handling', () => {
    const injected = readSrc('src/media-detection/observers/injected-script.ts');
    assert(injected.includes("window.addEventListener('popstate'"), 'popstate hook');
    assert(injected.includes('history.pushState'), 'pushState hook');
    assert(injected.includes('history.replaceState'), 'replaceState hook');
    assert(injected.includes('scheduleActiveVideo'), 'reschedule active video');

    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/one',
      navigationEpoch: 7,
    });
    const back = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/two',
      navigationEpoch: 7,
    });
    const again = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/one',
      navigationEpoch: 7,
    });
    assert(again != null && back != null, 'pop contexts');
    assert(again!.pageGeneration > back!.pageGeneration, 'popstate path bump');
  });

  await test('16. tab isolation', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://site-a.example/video',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-b',
      pageUrl: 'https://site-b.example/video',
      navigationEpoch: 1,
    });
    const a = generalPageMediaContextStore.get('tab-a');
    const b = generalPageMediaContextStore.get('tab-b');
    assert(a?.pageUrl.includes('site-a'), 'tab a');
    assert(b?.pageUrl.includes('site-b'), 'tab b');

    const cross = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({
          id: 'b-media',
          url: 'https://cdn.example.com/main.mp4',
          pageUrl: 'https://site-b.example/video',
        }),
      ],
      context: makeContext({ tabId: 'tab-a' }),
      tabId: 'tab-b',
      navigationEpoch: 1,
      pageUrl: 'https://site-b.example/video',
    });
    assert(cross.media == null, 'wrong tab cannot claim');
  });

  await test('17. closed-tab late result no-op', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-x');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-x',
      pageUrl: 'https://example.com/v',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.clearTab('tab-x');
    assert(generalPageMediaContextStore.get('tab-x') == null, 'cleared');
    const late = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-x',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://example.com/v',
        elementIdentity: 'late',
        currentSrc: 'https://cdn.example.com/late.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 640,
        videoHeight: 360,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 1,
        viewportCenterDistance: 0,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: null,
        observedAt: Date.now(),
      },
    });
    assert(late == null, 'late callback no-ops');
    assert(generalPageMediaContextStore.get('tab-x') == null, 'no recreate');
  });

  await test('18. repeated same observation deduped', () => {
    const injected = readSrc('src/media-detection/observers/injected-script.ts');
    assert(injected.includes('lastActiveVideoKey'), 'active video key dedupe');
    assert(injected.includes('if (key === lastActiveVideoKey) return'), 'skip duplicate');
  });

  await test('19. current media remains stable when duplicate observer events arrive', () => {
    const ctx = makeContext();
    const main = makeMedia({ id: 'main', url: 'https://cdn.example.com/main.mp4' });
    const first = selectCurrentGeneralMedia({
      candidates: [main],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    const second = selectCurrentGeneralMedia({
      candidates: [main, makeMedia({ ...main, id: 'main', detectedAt: Date.now() })],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(first.media?.id === 'main', 'first');
    assert(second.media?.id === 'main', 'stable');
    assert(second.group.confidence === first.group.confidence, 'confidence stable');
  });

  await test('20. no polling', () => {
    const generalFiles = [
      'src/media-detection/general-media/general-page-context.ts',
      'src/media-detection/general-media/general-correlation.service.ts',
      'src/media-detection/general-media/general-media-diagnostics.ts',
    ];
    for (const rel of generalFiles) {
      const src = readSrc(rel);
      assert(!/setInterval\s*\(/.test(src), `${rel} must not poll`);
    }
    const injected = readSrc('src/media-detection/observers/injected-script.ts');
    // Active-video path must stay event-driven (IO + play/pause), not a DOM poll loop.
    assert(injected.includes('IntersectionObserver'), 'event-driven IO');
    assert(injected.includes("addEventListener('play'"), 'play events');
    assert(injected.includes('scheduleActiveVideo'), 'coalesced active video');
    assert(
      !/setInterval\s*\(\s*function[^{]*\{[^}]*querySelectorAll\s*\(\s*['"]video['"]/s.test(
        injected,
      ),
      'no setInterval DOM video poll',
    );
    // Existing PerformanceObserver-missing fallback may use setInterval — must not be 1s DOM scan.
    const perfPoll = injected.match(/setInterval\([^,]+,\s*(\d+)/);
    if (perfPoll) {
      assert(Number(perfPoll[1]) >= 1000, 'perf fallback not sub-second thrash');
    }
  });

  await test('21. bounded candidate maps', () => {
    assert(DETECTION_TIMING.maxDetectedPerPage <= 80, 'detection bound');
    generalPageMediaContextStore.clearAll();
    for (let i = 0; i < 12; i += 1) {
      generalPageMediaContextStore.syncFromPageUrl({
        tabId: `tab-${i}`,
        pageUrl: `https://example.com/p/${i}`,
        navigationEpoch: 1,
      });
    }
    assert(
      generalPageMediaContextStore.size() <= 8,
      `tab contexts bounded, got ${generalPageMediaContextStore.size()}`,
    );
    const ctxSrc = readSrc('src/media-detection/general-media/general-page-context.ts');
    assert(ctxSrc.includes('MAX_TAB_CONTEXTS = 8'), 'max tabs');
    assert(ctxSrc.includes('MAX_PREVIOUS_PER_TAB'), 'previous bound');
  });

  await test('22. Home/error clears context', () => {
    const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
    assert(engine.includes('onGoHome'), 'home hook');
    assert(engine.includes('onBrowserError'), 'error hook');
    assert(
      engine.includes('generalPageMediaContextStore.clearTab'),
      'clears general on home/error',
    );

    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-home');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-home',
      pageUrl: 'https://example.com/video',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.clearTab('tab-home');
    assert(generalPageMediaContextStore.get('tab-home') == null, 'cleared');
  });

  await test('architecture: no parallel detector / reuses pipeline', () => {
    assert(
      existsSync(join(ROOT, 'src/media-detection/general-media/general-correlation.service.ts')),
      'general correlation exists',
    );
    assert(
      !existsSync(join(ROOT, 'src/media-detection/GeneralWebDetector2.ts')),
      'no parallel detector',
    );
    const discovery = readSrc('src/media-detection/hooks/useMediaDiscovery.ts');
    assert(
      discovery.includes('selectCurrentMediaForActiveGeneralTab'),
      'discovery uses Phase 5A',
    );
    const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
    assert(engine.includes('syncGeneralMediaContext'), 'engine syncs general');
    assert(engine.includes('isSameOriginSpaTransition'), 'SPA general support');
  });

  console.log(`\nPhase 5A results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
