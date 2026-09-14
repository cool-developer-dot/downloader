/**
 * Phase 4A — Social content identity & correlation verifier.
 * Usage (from mobile/): npm run verify:phase4a-social-correlation
 *
 * Deterministic TypeScript checks only — no Maestro / Appium / Python.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractInstagramContentIdentity,
  extractTikTokContentIdentity,
  isSameSocialContent,
  selectCurrentSocialMedia,
  socialPageContextStore,
  correlateSocialCandidate,
  type SocialPageContext,
} from '../src/media-detection/social';
import { dedupeUpsert } from '../src/media-detection/services/deduplication.service';
import { isFalsePositive } from '../src/media-detection/services/false-positive.filter';
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

function makeMedia(partial: Partial<DetectedMedia> & { id: string; url: string }): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: 'https://www.instagram.com/reel/ABC123/',
    title: null,
    thumbnailUrl: null,
    duration: null,
    width: 720,
    height: 1280,
    resolution: '720p',
    aspectRatio: 0.5625,
    fps: null,
    estimatedFileSize: 1_000_000,
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
    websiteSource: 'instagram.com',
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
    detectedAt: Date.now(),
    confidence: 0.7,
    downloadable: true,
    requiresCookies: true,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'INSTAGRAM',
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

function makeContext(
  overrides: Partial<SocialPageContext> = {},
): SocialPageContext {
  return {
    tabId: 'tab-a',
    navigationEpoch: 1,
    platform: 'instagram',
    pageUrl: 'https://www.instagram.com/reel/ABC123/',
    canonicalPageUrl: 'https://www.instagram.com/reel/ABC123/',
    contentType: 'instagram_reel',
    canonicalContentId: 'ABC123',
    ephemeralContentId: null,
    activeVideoElementIdentity: 'v1',
    currentVisibleMediaIdentity: 'instagram:instagram_reel:ABC123',
    activeVideoCurrentSrc: 'https://cdninstagram.com/v/ABC123.mp4',
    activeVideoIsBlob: false,
    activeVideoIntersectionRatio: 0.92,
    activeVideoPaused: false,
    activeVideoRecentlyPlayed: true,
    explicitAdMarker: false,
    contextGeneration: 10,
    identityConfidence: 'STRONG',
    observedAt: Date.now(),
    ...overrides,
  };
}

console.log('Phase 4A — Social Correlation Verification\n');

async function main(): Promise<void> {
  socialPageContextStore.clearAll();

  await test('1. Instagram /reel/{id} extraction', () => {
    const id = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/ABC123xyz/?igsh=1',
    );
    assert(id?.canonicalContentId === 'ABC123xyz', 'shortcode');
    assert(id?.contentType === 'instagram_reel', 'reel type');
    assert(id?.platform === 'instagram', 'platform');
  });

  await test('2. Instagram /p/{id} distinction', () => {
    const id = extractInstagramContentIdentity(
      'https://www.instagram.com/p/XYZ456post/',
    );
    assert(id?.canonicalContentId === 'XYZ456post', 'post shortcode');
    assert(id?.contentType === 'instagram_post', 'post type not reel');
  });

  await test('3. TikTok /@user/video/{id} extraction', () => {
    const id = extractTikTokContentIdentity(
      'https://www.tiktok.com/@creator/video/7123456789012345678',
    );
    assert(id?.canonicalContentId === '7123456789012345678', 'video id');
    assert(id?.contentType === 'tiktok_video', 'type');
    assert(id?.platform === 'tiktok', 'platform');
  });

  await test('4. wrong-tab event rejection', () => {
    const ctx = makeContext({ tabId: 'tab-a' });
    const media = makeMedia({
      id: 'm1',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
    });
    const result = correlateSocialCandidate(media, {
      context: ctx,
      tabId: 'tab-b',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'rejected');
    assert(result.rejectionReason === 'WRONG_TAB', 'wrong tab reason');
  });

  await test('5. stale navigation rejection', () => {
    const ctx = makeContext({ navigationEpoch: 5 });
    const media = makeMedia({
      id: 'm1',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
    });
    const result = correlateSocialCandidate(media, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 4,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'rejected');
    assert(result.rejectionReason === 'STALE_NAVIGATION', 'stale nav');
  });

  await test('6. stale social-context generation rejection', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-a');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.instagram.com/reel/AAA111/',
      navigationEpoch: 1,
    });
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.instagram.com/reel/BBB222/',
      navigationEpoch: 1,
    });
    const current = socialPageContextStore.get('tab-a');
    assert(current?.canonicalContentId === 'BBB222', 'new content');
    assert(
      socialPageContextStore.isStaleGeneration('tab-a', 1, (current!.contextGeneration) - 1),
      'old generation stale',
    );
  });

  await test('7. active visible video outranks weak network-only', () => {
    const ctx = makeContext();
    const active = makeMedia({
      id: 'active',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
      estimatedFileSize: 500_000,
      confidence: 0.55,
    });
    const weakLarge = makeMedia({
      id: 'weak',
      url: 'https://cdninstagram.com/v/OTHER.mp4',
      estimatedFileSize: 50_000_000,
      confidence: 0.95,
      detectionSource: 'js_fetch',
    });
    const { media, group } = selectCurrentSocialMedia({
      candidates: [weakLarge, active],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(media?.id === 'active', 'active wins over larger weak');
    assert(group.confidence === 'STRONG' || group.confidence === 'MEDIUM', 'strong/medium');
  });

  await test('8. neighbor preload cannot replace active content', () => {
    const ctx = makeContext({
      activeVideoCurrentSrc: 'https://cdninstagram.com/v/ABC123.mp4',
      activeVideoIntersectionRatio: 0.9,
    });
    const active = makeMedia({
      id: 'a',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
    });
    const neighbor = makeMedia({
      id: 'b',
      url: 'https://cdninstagram.com/v/NEIGHBOR.mp4',
      estimatedFileSize: 99_000_000,
      detectedAt: Date.now() + 1000,
    });
    const { media } = selectCurrentSocialMedia({
      candidates: [neighbor, active],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(media?.id === 'a', 'neighbor must not replace');
    const neighborCorr = correlateSocialCandidate(neighbor, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(
      neighborCorr.confidence === 'REJECTED' ||
        neighborCorr.rejectionReason === 'OFFSCREEN_PRELOAD',
      'neighbor rejected/preloaded',
    );
  });

  await test('9. hidden video penalized/rejected', () => {
    const ctx = makeContext({
      activeVideoIntersectionRatio: 0.05,
      activeVideoPaused: true,
      activeVideoRecentlyPlayed: false,
      activeVideoCurrentSrc: 'https://cdninstagram.com/v/HIDDEN.mp4',
    });
    const hidden = makeMedia({
      id: 'h',
      url: 'https://cdninstagram.com/v/OTHER.mp4',
    });
    const result = correlateSocialCandidate(hidden, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(
      result.confidence === 'REJECTED' &&
        (result.rejectionReason === 'HIDDEN_VIDEO' ||
          result.rejectionReason === 'OFFSCREEN_PRELOAD'),
      `hidden rejected got ${result.rejectionReason}`,
    );
  });

  await test('10. image/poster rejected', () => {
    assert(
      isFalsePositive({
        url: 'https://cdninstagram.com/v/poster.jpg',
        mimeType: 'image/jpeg',
      }),
      'jpg false positive',
    );
    const ctx = makeContext();
    const poster = makeMedia({
      id: 'p',
      url: 'https://cdninstagram.com/v/thumb.webp?width=150',
      mimeType: 'image/webp',
      extension: 'webp',
      category: 'video',
    });
    const result = correlateSocialCandidate(poster, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'poster rejected');
    assert(
      result.rejectionReason === 'IMAGE_RESOURCE' ||
        result.rejectionReason === 'NON_VIDEO' ||
        result.rejectionReason === 'LOW_CORRELATION',
      'image reason',
    );
  });

  await test('11. .ts rejected', () => {
    assert(
      isFalsePositive({ url: 'https://cdn.example.com/seg/001.ts' }),
      'ts segment',
    );
  });

  await test('12. .m4s rejected', () => {
    assert(
      isFalsePositive({ url: 'https://cdn.example.com/dash/chunk_01.m4s' }),
      'm4s segment',
    );
  });

  await test('13. blob-only rejected as final source', () => {
    const ctx = makeContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://instagram.com/abc',
    });
    const blob = makeMedia({
      id: 'blob',
      url: 'blob:https://instagram.com/abc',
    });
    const result = correlateSocialCandidate(blob, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'blob rejected');
    assert(result.rejectionReason === 'BLOB_ONLY', 'blob reason');
  });

  await test('14. blob active-video can correlate underlying resource', () => {
    const ctx = makeContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://instagram.com/abc',
      activeVideoIntersectionRatio: 0.95,
      activeVideoRecentlyPlayed: true,
    });
    const underlying = makeMedia({
      id: 'net',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
    });
    const result = correlateSocialCandidate(underlying, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(
      result.confidence === 'MEDIUM' || result.confidence === 'STRONG' || result.confidence === 'WEAK',
      'underlying allowed',
    );
    assert(result.confidence !== 'REJECTED', 'not rejected');
  });

  await test('15. same signed-resource path does not create new content identity', () => {
    const a = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/ABC123/',
    );
    const b = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/ABC123/?utm=1',
    );
    assert(isSameSocialContent(a, b), 'same content');
    assert(a?.canonicalContentId === b?.canonicalContentId, 'same id');
  });

  await test('16. new Instagram Reel creates new content identity', () => {
    const a = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/AAA111/',
    );
    const b = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/BBB222/',
    );
    assert(!isSameSocialContent(a, b), 'different content');
  });

  await test('17. new TikTok video creates new content identity', () => {
    const a = extractTikTokContentIdentity(
      'https://www.tiktok.com/@u/video/1111111111111111111',
    );
    const b = extractTikTokContentIdentity(
      'https://www.tiktok.com/@u/video/2222222222222222222',
    );
    assert(!isSameSocialContent(a, b), 'different tiktok');
  });

  await test('18. recycled DOM element can change media ownership', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-a');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.instagram.com/reels/',
      navigationEpoch: 2,
    });
    const gen1 = socialPageContextStore.get('tab-a')!.contextGeneration;
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 2,
      evidence: {
        pageUrl: 'https://www.instagram.com/reels/',
        elementIdentity: 'v1',
        currentSrc: 'https://cdninstagram.com/v/OLD.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 720,
        videoHeight: 1280,
        muted: true,
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
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 2,
      evidence: {
        pageUrl: 'https://www.instagram.com/reels/',
        elementIdentity: 'v1',
        currentSrc: 'https://cdninstagram.com/v/NEW.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 720,
        videoHeight: 1280,
        muted: true,
        currentTimeBucket: 1,
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
    const after = socialPageContextStore.get('tab-a')!;
    assert(after.contextGeneration > gen1, 'generation bumped on recycle');
    assert(
      after.activeVideoCurrentSrc?.includes('NEW.mp4'),
      'new src ownership',
    );
  });

  await test('19. same candidate multi-observer dedupes', () => {
    const a = makeMedia({
      id: 'md_x',
      url: 'https://cdninstagram.com/v/same.mp4',
      detectionSource: 'dom_video',
    });
    const b = makeMedia({
      id: 'md_y',
      url: 'https://cdninstagram.com/v/same.mp4',
      detectionSource: 'js_fetch',
      confidence: 0.8,
    });
    const first = dedupeUpsert([], a, DETECTION_TIMING.maxDetectedPerPage);
    const second = dedupeUpsert(
      first.items,
      b,
      DETECTION_TIMING.maxDetectedPerPage,
    );
    assert(second.items.length === 1, 'deduped to one');
    assert(second.updated || second.inserted === false, 'merged');
  });

  await test('20. old candidate cannot replace new strong context', () => {
    const ctx = makeContext({
      canonicalContentId: 'BBB222',
      pageUrl: 'https://www.instagram.com/reel/BBB222/',
      activeVideoCurrentSrc: 'https://cdninstagram.com/v/BBB222.mp4',
      contextGeneration: 11,
    });
    const oldA = makeMedia({
      id: 'old',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
      pageUrl: 'https://www.instagram.com/reel/ABC123/',
    });
    const newB = makeMedia({
      id: 'new',
      url: 'https://cdninstagram.com/v/BBB222.mp4',
      pageUrl: 'https://www.instagram.com/reel/BBB222/',
    });
    const { media } = selectCurrentSocialMedia({
      candidates: [oldA, newB],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(media?.id === 'new', 'new context wins');
  });

  await test('21. inactive tab cannot drive active media', () => {
    const ctx = makeContext({ tabId: 'tab-ig' });
    const media = makeMedia({
      id: 'x',
      url: 'https://cdninstagram.com/v/ABC123.mp4',
    });
    const { media: selected } = selectCurrentSocialMedia({
      candidates: [media],
      context: ctx,
      tabId: 'tab-tt',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(selected == null, 'inactive tab blocked');
  });

  await test('22. closing tab clears context', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-close',
      pageUrl: 'https://www.tiktok.com/@u/video/1234567890123456789',
      navigationEpoch: 3,
    });
    assert(socialPageContextStore.get('tab-close') != null, 'exists');
    socialPageContextStore.clearTab('tab-close');
    assert(socialPageContextStore.get('tab-close') == null, 'cleared');
  });

  await test('23. social context remains ephemeral (no persistence APIs)', () => {
    const ctxSrc = readSrc('src/media-detection/social/social-page-context.ts');
    assert(!/from\s+['"]react-native-mmkv['"]/.test(ctxSrc), 'no mmkv import');
    assert(!/expo-sqlite|AsyncStorage|openDatabase/.test(ctxSrc), 'no sqlite/asyncstorage');
    assert(
      /ephemeral|Never persisted/i.test(ctxSrc),
      'documents ephemeral policy',
    );
    assert(ctxSrc.includes('const byTab = new Map'), 'in-memory Map only');
  });

  await test('24. no backend/API introduced', () => {
    const socialDir = join(ROOT, 'src/media-detection/social');
    assert(existsSync(socialDir), 'social module exists');
    for (const file of [
      'social-correlation.service.ts',
      'social-page-context.ts',
      'instagram-content-identity.ts',
      'tiktok-content-identity.ts',
    ]) {
      const src = readSrc(`src/media-detection/social/${file}`);
      assert(!/fetch\s*\(\s*['"`]https?:\/\/api\./i.test(src), `${file} no api fetch`);
      assert(!src.includes('supabase'), `${file} no supabase`);
      assert(!src.includes('firebase'), `${file} no firebase`);
    }
  });

  await test('25. no polling loop introduced', () => {
    const corr = readSrc('src/media-detection/social/social-correlation.service.ts');
    const ctx = readSrc('src/media-detection/social/social-page-context.ts');
    assert(!corr.includes('setInterval'), 'no setInterval in correlation');
    assert(!ctx.includes('setInterval'), 'no setInterval in context');
    const injected = readSrc('src/media-detection/observers/injected-script.ts');
    assert(injected.includes('active_video'), 'active_video evidence');
    assert(injected.includes('IntersectionObserver'), 'IO reuse');
    assert(
      !/addEventListener\(\s*['"]timeupdate['"]/.test(injected),
      'no timeupdate listener flood',
    );
  });

  await test('Instagram feed does not fabricate content id from host', () => {
    const home = extractInstagramContentIdentity('https://www.instagram.com/');
    assert(home?.canonicalContentId == null, 'no fabricated id');
    assert(home?.contentType === 'instagram_feed_video', 'feed type');
  });

  await test('CDN URL is not content identity', () => {
    const id = extractInstagramContentIdentity(
      'https://www.instagram.com/reel/ABC123/',
    );
    assert(id?.canonicalContentId === 'ABC123', 'id is shortcode');
    assert(!id?.canonicalContentId?.includes('cdn'), 'not cdn');
  });

  await test('parked WebView media messages gated by isActive', () => {
    const webview = readSrc(
      'src/browser/components/BrowserContainer/BrowserWebView.tsx',
    );
    assert(webview.includes('if (!isActive)'), 'isActive gate');
    assert(webview.includes('onMediaDetectionMessage'), 'media message');
  });

  console.log(`\nPhase 4A result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
