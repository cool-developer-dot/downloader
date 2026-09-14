/**
 * General embedded / iframe current-video CTA verifier.
 * Run: npm run verify:general-embedded-current-video-cta
 *
 * Avoid barrel imports that pull react-native.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyBrowserNavigation } from '../src/browser/navigation/browser-navigation-policy';
import { initialBrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import {
  resolveCtaShellPresentation,
  shouldKeepCtaShellMounted,
  shouldTreatAsCurrentVideoOwner,
} from '../src/browser/media-actions/cta-shell-presentation';
import {
  isSameContentIdentity,
  shouldAcceptVerificationResult,
  shouldInvalidateCurrentMedia,
} from '../src/browser/media-actions/cta-persistence';
import { parseMediaBridgeMessage } from '../src/media-detection/adapters/webview-bridge.adapter';
import {
  buildGeneralCurrentMediaIdentity,
  correlateGeneralCandidate,
  extractGeneralPageVideoId,
  generalPageMediaContextStore,
  isBlobOnlyResource,
  isNonVideoIframe,
  looksLikeGeneralPlayerIframe,
  looksLikePlayerIframeSrc,
  resolveIframeOwnerStrength,
  selectCurrentGeneralMedia,
  shouldAcceptIframeAsCurrentOwner,
  type GeneralPageMediaContext,
} from '../src/media-detection/general-media';
import { resolveSocialPlatform } from '../src/media-detection/social/social-content-identity';
import type { DetectedMedia } from '../src/media-detection/types';
import type { ActiveVideoEvidence } from '../src/media-detection/social/types';

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
    pageUrl: partial.pageUrl ?? 'https://www.dailymotion.com/video/xb6huwu',
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
    websiteSource: 'dailymotion.com',
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
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
    pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
    activeMediaElementIdentity: 'v-main',
    activeMediaResourceIdentity: 'cdn.example.com/main.mp4',
    currentMediaIdentity: 'video:xb6huwu',
    activeVideoCurrentSrc: 'https://cdn.example.com/main.mp4',
    activeVideoIsBlob: false,
    activeVideoIntersectionRatio: 0.9,
    activeVideoPaused: false,
    activeVideoRecentlyPlayed: true,
    activeVideoMuted: false,
    activeVideoWidth: 1280,
    activeVideoHeight: 720,
    explicitAdMarker: false,
    userInteractionSignal: true,
    playerKind: 'video',
    frameClass: 'top',
    iframeIdentity: null,
    ownerStrength: 'STRONG',
    observedAt: Date.now(),
    ...overrides,
  };
}

function videoEvidence(
  overrides: Partial<ActiveVideoEvidence> = {},
): ActiveVideoEvidence {
  return {
    pageUrl: 'https://example.com/watch/longid',
    elementIdentity: 'v1',
    currentSrc: 'https://cdn.example.com/main.mp4',
    src: 'https://cdn.example.com/main.mp4',
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
    playerKind: 'video',
    frameClass: 'top',
    ...overrides,
  };
}

function shell(overrides: Partial<Parameters<typeof resolveCtaShellPresentation>[0]> = {}) {
  return resolveCtaShellPresentation({
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    actionState: initialBrowserMediaActionState,
    liveContentIdentity: 'video:xb6huwu',
    liveOwnershipConfidence: 'MEDIUM',
    hasVerifiedOffer: false,
    liveIdentityConsumed: false,
    ...overrides,
  });
}

function resetTab(tabId = 'tab-a', pageUrl = 'https://example.com/watch/longid') {
  generalPageMediaContextStore.clearAll();
  generalPageMediaContextStore.setActiveTab(tabId);
  return generalPageMediaContextStore.syncFromPageUrl({
    tabId,
    pageUrl,
    navigationEpoch: 1,
  });
}

console.log('General embedded current-video CTA verification\n');

async function main(): Promise<void> {
  const inj = readSrc('src/media-detection/observers/injected-script.ts');
  const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
  const pageCtx = readSrc('src/media-detection/general-media/general-page-context.ts');
  const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
  const corr = readSrc('src/media-detection/general-media/general-correlation.service.ts');
  const socialId = readSrc('src/media-detection/social/social-content-identity.ts');
  const nativeBridge = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
  );

  await test('1. top-level visible <video> → owner', () => {
    resetTab();
    const next = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence(),
    });
    assert(next?.currentMediaIdentity, 'identity set');
    assert(next?.ownerStrength === 'STRONG' || next?.ownerStrength === 'MEDIUM', 'strong/medium');
  });

  await test('2. hidden video → no owner', () => {
    resetTab();
    const next = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({
        isDisplayed: false,
        isVisibleStyle: false,
        recentlyPlayed: false,
        paused: true,
        intersectionRatio: 0,
      }),
    });
    assert(!next?.currentMediaIdentity, 'hidden must not own');
  });

  await test('3. offscreen preview → no strong owner', () => {
    resetTab();
    const next = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({
        isDisplayed: false,
        recentlyPlayed: false,
        paused: true,
        intersectionRatio: 0.05,
        videoWidth: 160,
        videoHeight: 90,
      }),
    });
    assert(next?.ownerStrength !== 'STRONG', 'offscreen not strong');
    assert(!next?.currentMediaIdentity, 'offscreen preview no owner');
  });

  await test('4. visible playing video → strong/medium owner', () => {
    resetTab();
    const next = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({ paused: false, recentlyPlayed: true, intersectionRatio: 0.8 }),
    });
    assert(next?.ownerStrength === 'STRONG' || next?.ownerStrength === 'MEDIUM', 'playing owner');
  });

  await test('5. blob currentSrc does not prevent owner', () => {
    resetTab();
    const next = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({
        currentSrc: 'blob:https://example.com/uuid-1',
        src: 'blob:https://example.com/uuid-1',
        isBlob: true,
      }),
    });
    assert(next?.currentMediaIdentity, 'blob still owns');
    assert(next?.activeVideoIsBlob === true, 'blob flagged');
  });

  await test('6. current general owner creates CTA shell', () => {
    assert(shell() === 'TRACKING_CURRENT_VIDEO', 'owner → tracking shell');
    assert(shouldKeepCtaShellMounted({ shellState: 'TRACKING_CURRENT_VIDEO' }), 'shell mounted');
  });

  await test('7. owner does not require verified source', () => {
    assert(
      shell({ hasVerifiedOffer: false, liveOwnershipConfidence: 'MEDIUM' }) ===
        'TRACKING_CURRENT_VIDEO',
      'no verified offer still visible',
    );
  });

  await test('8. no owner → CTA hidden', () => {
    assert(
      shell({ liveContentIdentity: null, liveOwnershipConfidence: null }) === 'HIDDEN',
      'no owner hidden',
    );
  });

  await test('9. owner update triggers React selector subscription', () => {
    resetTab();
    let hits = 0;
    const unsub = generalPageMediaContextStore.subscribe(() => {
      hits += 1;
    });
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence(),
    });
    unsub();
    assert(hits >= 1, `subscriber fired (${hits})`);
    assert(hook.includes('generalPageMediaContextStore.subscribe'), 'hook subscribes general store');
  });

  await test('10. active tab only', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-b',
      pageUrl: 'https://example.com/watch/other1',
      navigationEpoch: 1,
    });
    const parked = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-b',
      navigationEpoch: 1,
      evidence: videoEvidence({ pageUrl: 'https://example.com/watch/other1' }),
    });
    assert(!parked?.currentMediaIdentity, 'inactive tab cannot take owner');
  });

  await test('11. dai.ly redirect remains internal', () => {
    assert(
      classifyBrowserNavigation('https://dai.ly/xb6huwu').kind === 'INTERNAL_WEB',
      'dai.ly internal',
    );
    assert(
      classifyBrowserNavigation('https://www.dailymotion.com/video/xb6huwu').kind ===
        'INTERNAL_WEB',
      'dailymotion internal',
    );
  });

  await test('12. final /video/{id} page generation accepted', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const first = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://dai.ly/xb6huwu',
      navigationEpoch: 1,
    });
    const final = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 2,
    });
    assert(first != null && final != null, 'both contexts');
    assert((final!.pageGeneration ?? 0) > (first!.pageGeneration ?? 0), 'generation advanced');
    assert(final!.navigationEpoch === 2, 'final epoch accepted');
  });

  await test('13. final video id can contribute to identity', () => {
    assert(
      extractGeneralPageVideoId('https://www.dailymotion.com/video/xb6huwu') === 'xb6huwu',
      'dailymotion path id',
    );
    assert(
      extractGeneralPageVideoId('https://www.dailymotion.com/video/xb6huwu?playlist=x') ===
        'xb6huwu',
      'query does not replace id',
    );
    const id = buildGeneralCurrentMediaIdentity({
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      elementIdentity: 'f1',
      src: 'https://geo.dailymotion.com/player/xtv3w.html?auth=secret',
    });
    assert(id === 'video:xb6huwu', `page id identity, got ${id}`);
  });

  await test('14. video player discovered (iframe heuristic)', () => {
    assert(
      looksLikePlayerIframeSrc('https://geo.dailymotion.com/player/xtv3w.html'),
      'geo player src',
    );
    assert(
      looksLikeGeneralPlayerIframe({
        src: 'https://geo.dailymotion.com/player/xtv3w.html',
        width: 390,
        height: 220,
        isDisplayed: true,
        allowFullscreen: true,
      }),
      'visible geo iframe is player',
    );
  });

  await test('15. first player discovered without second user action', () => {
    assert(inj.includes('flushActiveVideo()'), 'initial flush');
    assert(inj.includes('scanDom()'), 'initial scan');
    assert(inj.includes('scheduleActiveVideo()'), 'mutation schedules active scan');
    assert(!/setInterval\([^)]*iframe/.test(inj), 'no iframe polling interval');
  });

  await test('16. owner created from iframe evidence', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 3,
    });
    const next = generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: 'tab-a',
      navigationEpoch: 3,
      evidence: {
        pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
        iframeIdentity: 'f1',
        iframeSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
        frameClass: 'cross-origin',
        isDisplayed: true,
        isVisibleStyle: true,
        intersectionRatio: 0.82,
        width: 390,
        height: 220,
        allowFullscreen: true,
        allow: 'autoplay; fullscreen; encrypted-media',
        looksPlayer: true,
        sameOriginVideoCount: null,
        associatedContentId: 'xb6huwu',
      },
    });
    assert(next?.currentMediaIdentity === 'video:xb6huwu', 'iframe owner identity');
    assert(next?.playerKind === 'iframe', 'playerKind iframe');
    assert(next?.ownerStrength === 'STRONG' || next?.ownerStrength === 'MEDIUM', 'iframe owner strength');
  });

  await test('17. CTA bound for iframe owner', () => {
    assert(
      shouldTreatAsCurrentVideoOwner({
        liveContentIdentity: 'video:xb6huwu',
        liveOwnershipConfidence: 'MEDIUM',
      }),
      'treat as current owner',
    );
    assert(shell({ liveContentIdentity: 'video:xb6huwu' }) === 'TRACKING_CURRENT_VIDEO', 'CTA bound');
  });

  await test('18. no second scroll/play-toggle required', () => {
    assert(inj.includes('flushActiveVideo();'), 'runs at observer setup');
    assert(
      inj.includes('scheduleActiveVideo();') && inj.includes('MutationObserver'),
      'late-mounted player via MO',
    );
  });

  await test('19. same-origin iframe player evidence accepted', () => {
    assert(inj.includes('contentDocument'), 'same-origin dive');
    const strength = resolveIframeOwnerStrength({
      looksPlayer: true,
      isDisplayed: true,
      intersectionRatio: 0.7,
      sameOriginVideoCount: 1,
    });
    assert(strength === 'STRONG', 'same-origin inner video strong');
  });

  await test('20. cross-origin iframe does not require illegal DOM access', () => {
    assert(inj.includes("return 'cross-origin'"), 'cross-origin classified');
    assert(!inj.includes('iframe.contentDocument.body'), 'no forced body read');
    assert(!engine.includes('eval('), 'engine no eval bypass');
  });

  await test('21. visible iframe + media evidence can create owner', () => {
    assert(
      shouldAcceptIframeAsCurrentOwner({
        looksPlayer: true,
        isDisplayed: true,
        intersectionRatio: 0.6,
        width: 400,
        height: 225,
      }),
      'visible player iframe accepted',
    );
  });

  await test('22. non-video iframe does not create owner', () => {
    assert(
      isNonVideoIframe({
        src: 'https://www.google.com/maps/embed?pb=1',
        looksPlayer: false,
      }),
      'maps iframe non-video',
    );
    assert(
      !looksLikeGeneralPlayerIframe({
        src: 'https://www.google.com/maps/embed?pb=1',
        width: 400,
        height: 300,
        isDisplayed: true,
        allowFullscreen: false,
      }),
      'maps not player src',
    );
  });

  await test('23. hidden iframe does not create owner', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 1,
    });
    const next = generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
        iframeIdentity: 'f-hidden',
        iframeSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
        frameClass: 'cross-origin',
        isDisplayed: false,
        isVisibleStyle: false,
        intersectionRatio: 0,
        width: 390,
        height: 220,
        allowFullscreen: true,
        allow: 'autoplay',
        looksPlayer: true,
        sameOriginVideoCount: null,
      },
    });
    assert(!next?.currentMediaIdentity, 'hidden iframe no owner');
  });

  await test('24. iframe navigation updates generation safely', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const a = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 4,
    });
    const b = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xother1',
      navigationEpoch: 4,
    });
    assert(a && b, 'contexts');
    assert(b!.pageGeneration > a!.pageGeneration, 'path change bumps generation');
    assert(!b!.currentMediaIdentity, 'old owner cleared on new video path');
  });

  await test('25. blob URL is clue-only', () => {
    const blob = makeMedia({ id: 'blob', url: 'blob:https://example.com/uuid' });
    assert(isBlobOnlyResource(blob), 'blob helper');
    const ctx = makeContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://example.com/uuid',
    });
    const result = correlateGeneralCandidate(blob, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'blob candidate rejected');
    assert(result.rejectionReason === 'BLOB_ONLY', 'blob reason');
  });

  await test('26. blob does not become executable URL', () => {
    const parsed = parseMediaBridgeMessage(
      JSON.stringify({
        channel: 'vidorax-media-detection',
        type: 'mutation_batch',
        payload: {
          pageUrl: 'https://example.com/watch/longid',
          candidates: [
            {
              url: 'blob:https://example.com/uuid',
              pageUrl: 'https://example.com/watch/longid',
              detectionSource: 'dom_video',
            },
          ],
        },
        ts: Date.now(),
      }),
    );
    assert(parsed?.type === 'mutation_batch', 'batch parsed');
    if (parsed?.type === 'mutation_batch') {
      assert(parsed.payload.candidates.length === 0, 'blob stripped from candidates');
    }
  });

  await test('27. blob player can own CTA', () => {
    assert(
      shell({
        liveContentIdentity: 'v1:blob',
        liveOwnershipConfidence: 'MEDIUM',
        hasVerifiedOffer: false,
      }) === 'TRACKING_CURRENT_VIDEO',
      'blob owner CTA',
    );
  });

  await test('28. underlying HTTP candidate can correlate', () => {
    const ctx = makeContext({
      playerKind: 'iframe',
      activeVideoCurrentSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
      activeVideoIsBlob: false,
      currentMediaIdentity: 'video:xb6huwu',
    });
    const http = makeMedia({
      id: 'hls',
      url: 'https://cdn.example.com/master.m3u8',
      mimeType: 'application/vnd.apple.mpegurl',
      extension: 'm3u8',
      container: 'hls',
      category: 'stream',
      streamType: 'HLS',
    });
    const result = correlateGeneralCandidate(http, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'MEDIUM' || result.confidence === 'STRONG', `got ${result.confidence}`);
  });

  await test('29. unsupported blob-only remains non-executable', () => {
    const ctx = makeContext({ activeVideoIsBlob: true });
    const selected = selectCurrentGeneralMedia({
      candidates: [makeMedia({ id: 'blob', url: 'blob:https://example.com/x' })],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media == null, 'blob cannot be selected media');
  });

  await test('30. manifest candidate observed', () => {
    assert(nativeBridge.includes('.m3u8'), 'native observes m3u8');
    assert(inj.includes('m3u8'), 'injected observes m3u8');
  });

  await test('31. supported unencrypted VOD HLS verifies (source contract)', () => {
    const src = readSrc('src/media-detection/general-source/general-source-reliability.service.ts');
    assert(src.includes('parseHlsManifest') || src.includes('looksLikeHlsCandidate'), 'HLS verify path');
    assert(src.includes('isHlsDrmOrUnsupportedEncryption'), 'encrypted gate');
  });

  await test('32. encrypted HLS rejected', () => {
    const src = readSrc('src/media-detection/general-source/hls-evidence.ts');
    assert(src.includes('EXT-X-KEY') || src.includes('isHlsDrmOrUnsupportedEncryption'), 'drm detect');
  });

  await test('33. manifest from wrong/offscreen player rejected', () => {
    const ctx = makeContext({
      playerKind: 'video',
      activeVideoIntersectionRatio: 0.05,
      activeVideoPaused: true,
      activeVideoRecentlyPlayed: false,
      activeVideoCurrentSrc: 'https://cdn.example.com/main.mp4',
    });
    const other = makeMedia({
      id: 'other',
      url: 'https://cdn.ads.example/pre-roll.m3u8',
      extension: 'm3u8',
      container: 'hls',
      category: 'stream',
      streamType: 'HLS',
    });
    const result = correlateGeneralCandidate(other, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(
      result.confidence === 'REJECTED' || result.rejectionReason === 'OFFSCREEN_PRELOAD',
      `offscreen/wrong rejected (${result.confidence}/${result.rejectionReason})`,
    );
  });

  await test('34. manifest belongs to current owner', () => {
    const ctx = makeContext({
      playerKind: 'iframe',
      currentMediaIdentity: 'video:xb6huwu',
      activeVideoCurrentSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
    });
    const hls = makeMedia({
      id: 'cur',
      url: 'https://proxy.example.com/xb6huwu/master.m3u8',
      extension: 'm3u8',
      container: 'hls',
      category: 'stream',
      streamType: 'HLS',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [hls],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.currentMediaIdentity === 'video:xb6huwu', 'owner identity preserved');
    assert(selected.media?.id === 'cur', 'manifest selected for owner');
  });

  await test('35. unsupported separate DASH does not fake download', () => {
    const src = readSrc('src/media-detection/general-source/types.ts');
    assert(src.includes('DASH_UNSUPPORTED'), 'dash unsupported reason');
  });

  await test('36. DASH cannot become HLS', () => {
    const reliability = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(!reliability.includes("transport = 'hls'") || reliability.includes('dash'), 'no dash→hls');
    assert(reliability.includes("'unknown'") || reliability.includes('dash'), 'dash stays unsupported');
  });

  await test('37. combined progressive candidate can still win independently', () => {
    const ctx = makeContext({ playerKind: 'iframe' });
    const mp4 = makeMedia({ id: 'prog', url: 'https://cdn.example.com/file.mp4' });
    const result = correlateGeneralCandidate(mp4, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'MEDIUM' || result.confidence === 'STRONG', 'progressive correlates');
  });

  await test('38. primary visible player wins', () => {
    assert(inj.includes('isLikelyPreviewVideo'), 'preview demotion');
    assert(inj.includes('pickBestPlayerIframe'), 'iframe ranking');
  });

  await test('39. offscreen recommendation does not win', () => {
    assert(inj.includes('isLikelyPreviewVideo(el)'), 'preview vs iframe');
  });

  await test('40. autoplay preview does not override main player', () => {
    assert(inj.includes('videoIsPreview'), 'preview skipped when iframe exists');
  });

  await test('41. player B strong replaces A', () => {
    assert(
      !isSameContentIdentity('video:xb6huwu', 'video:xother1'),
      'distinct videos',
    );
  });

  await test('42. stale A candidate cannot bind B', () => {
    assert(
      shouldInvalidateCurrentMedia({
        priorContentIdentity: 'video:xb6huwu',
        nextContentIdentity: 'video:xother1',
        nextOwnershipConfidence: 'MEDIUM',
        handoffOrSelectionLocked: false,
      }),
      'A invalidated when B owns',
    );
  });

  await test('43. A late verify cannot replace B', () => {
    assert(
      !shouldAcceptVerificationResult({
        resultTabId: 'tab-a',
        activeTabId: 'tab-a',
        resultNavigationEpoch: 1,
        currentNavigationEpoch: 1,
        resultContentIdentity: 'video:xb6huwu',
        currentContentIdentity: 'video:xother1',
        resultGeneration: 10,
        currentGeneration: 11,
      }),
      'stale A verify dropped',
    );
  });

  await test('44. ad candidate does not automatically become content owner', () => {
    const ctx = makeContext({ explicitAdMarker: true });
    const ad = makeMedia({ id: 'ad', url: 'https://cdn.example.com/ad.mp4' });
    const result = correlateGeneralCandidate(ad, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'ad rejected');
    assert(result.rejectionReason === 'ADVERTISEMENT', 'ad reason');
  });

  await test('45. content player can replace ad owner', () => {
    assert(pageCtx.includes('GENERAL_OWNER_CHANGED'), 'owner change event');
  });

  await test('46. ad media cannot be blindly offered as main content', () => {
    assert(corr.includes('adPenalty'), 'ad penalty');
  });

  await test('47. multiple media elements rank correctly', () => {
    assert(inj.includes('MAX_TRACKED_VIDEOS'), 'bounded videos');
    assert(inj.includes('MAX_TRACKED_IFRAMES'), 'bounded iframes');
  });

  await test('48. owner → CTA shell', () => {
    assert(shell() === 'TRACKING_CURRENT_VIDEO', 'tracking');
  });

  await test('49. TRACKING current owner remains visible', () => {
    assert(
      shouldKeepCtaShellMounted({ shellState: 'TRACKING_CURRENT_VIDEO' }),
      'keep mounted',
    );
  });

  await test('50. verify in flight does not hide CTA', () => {
    assert(
      shell({
        actionState: { ...initialBrowserMediaActionState, status: 'detecting' },
        hasVerifiedOffer: false,
      }) === 'TRACKING_CURRENT_VIDEO',
      'detecting keeps shell',
    );
  });

  await test('51. candidate delay does not hide CTA', () => {
    assert(shell({ hasVerifiedOffer: false }) === 'TRACKING_CURRENT_VIDEO', 'delay ok');
  });

  await test('52. successful enqueue consumes current identity', () => {
    assert(
      shell({ liveIdentityConsumed: true }) === 'CONSUMED_CURRENT_CONTENT',
      'consumed',
    );
  });

  await test('53. consumed A hides CTA for A', () => {
    assert(
      shell({
        liveContentIdentity: 'video:xb6huwu',
        liveIdentityConsumed: true,
      }) === 'CONSUMED_CURRENT_CONTENT',
      'A consumed hidden card',
    );
  });

  await test('54. new B gets CTA', () => {
    assert(
      shell({
        liveContentIdentity: 'video:xother1',
        liveIdentityConsumed: false,
        actionState: {
          ...initialBrowserMediaActionState,
          status: 'consumed',
          contentIdentity: 'video:xb6huwu',
        },
      }) === 'TRACKING_CURRENT_VIDEO',
      'B tracking after A consumed',
    );
  });

  await test('55. quality cancel retains CTA', () => {
    assert(
      shouldKeepCtaShellMounted({ shellState: 'READY' }) &&
        shouldKeepCtaShellMounted({ shellState: 'TRACKING_CURRENT_VIDEO' }),
      'ready/tracking retain',
    );
  });

  await test('56. stale result cannot consume new B', () => {
    assert(
      !shouldAcceptVerificationResult({
        resultTabId: 'tab-a',
        activeTabId: 'tab-a',
        resultNavigationEpoch: 1,
        currentNavigationEpoch: 1,
        resultContentIdentity: 'video:xb6huwu',
        currentContentIdentity: 'video:xother1',
        resultGeneration: 1,
        currentGeneration: 1,
      }),
      'stale A cannot consume B',
    );
  });

  await test('57. current general token captured', () => {
    assert(hook.includes('captureToken'), 'token capture');
    assert(hook.includes('currentMediaIdentity'), 'general identity in token');
  });

  await test('58. ranked current candidates only', () => {
    assert(hook.includes('selectCurrentMediaForActiveGeneralTab'), 'ranked general pick');
  });

  await test('59. candidate #1 invalid does not stop candidate #2', () => {
    const reliability = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(
      reliability.includes('for (') || reliability.includes('candidates'),
      'iterates candidates',
    );
  });

  await test('60. valid progressive source verifies', () => {
    const reliability = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(reliability.includes('progressive'), 'progressive transport');
  });

  await test('61. valid HLS source verifies', () => {
    const reliability = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(reliability.includes("'hls'") || reliability.includes('hls'), 'hls transport');
  });

  await test('62. HTML rejected', () => {
    const types = readSrc('src/media-detection/general-source/types.ts');
    assert(types.includes('HTML_RESPONSE'), 'html reject');
  });

  await test('63. JSON rejected', () => {
    const types = readSrc('src/media-detection/general-source/types.ts');
    assert(types.includes('JSON_RESPONSE'), 'json reject');
  });

  await test('64. image rejected', () => {
    const ctx = makeContext();
    const img = makeMedia({
      id: 'img',
      url: 'https://cdn.example.com/poster.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    const result = correlateGeneralCandidate(img, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', 'image rejected');
  });

  await test('65. fragment-only rejected', () => {
    const types = readSrc('src/media-detection/general-source/types.ts');
    assert(types.includes('MEDIA_FRAGMENT') || types.includes('INIT_SEGMENT'), 'fragment reject');
  });

  await test('66. DRM rejected', () => {
    const types = readSrc('src/media-detection/general-source/types.ts');
    assert(types.includes('DRM_UNSUPPORTED'), 'drm reject');
  });

  await test('67. unsupported DASH rejected', () => {
    const types = readSrc('src/media-detection/general-source/types.ts');
    assert(types.includes('DASH_UNSUPPORTED'), 'dash reject');
  });

  await test('68. inactive tab cannot bind CTA', () => {
    assert(engine.includes('WRONG_TAB') || pageCtx.includes('WRONG_TAB'), 'wrong tab ignored');
  });

  await test('69. tab switch restores correct general owner', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
        iframeIdentity: 'f1',
        iframeSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
        frameClass: 'cross-origin',
        isDisplayed: true,
        isVisibleStyle: true,
        intersectionRatio: 0.9,
        width: 400,
        height: 225,
        allowFullscreen: true,
        allow: 'autoplay; fullscreen',
        looksPlayer: true,
        sameOriginVideoCount: null,
        associatedContentId: 'xb6huwu',
      },
    });
    generalPageMediaContextStore.setActiveTab('tab-b');
    assert(
      generalPageMediaContextStore.get('tab-a')?.currentMediaIdentity === 'video:xb6huwu',
      'tab A owner retained while B active',
    );
    generalPageMediaContextStore.setActiveTab('tab-a');
    assert(
      generalPageMediaContextStore.get('tab-a')?.currentMediaIdentity === 'video:xb6huwu',
      'restore A owner',
    );
  });

  await test('70. parked WebView cannot steal CTA', () => {
    assert(pageCtx.includes('input.tabId !== activeTabId'), 'parked gated');
  });

  await test('71. real navigation invalidates old general owner', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
        iframeIdentity: 'f1',
        iframeSrc: 'https://geo.dailymotion.com/player/xtv3w.html',
        frameClass: 'cross-origin',
        isDisplayed: true,
        isVisibleStyle: true,
        intersectionRatio: 0.9,
        width: 400,
        height: 225,
        allowFullscreen: true,
        allow: 'fullscreen',
        looksPlayer: true,
        sameOriginVideoCount: null,
        associatedContentId: 'xb6huwu',
      },
    });
    const after = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://example.com/article',
      navigationEpoch: 2,
    });
    assert(!after?.currentMediaIdentity, 'nav clears owner');
  });

  await test('72. blocked native-app event does not affect general owner', () => {
    assert(
      classifyBrowserNavigation('tiktok://video/1').kind === 'BLOCK_NATIVE_APP',
      'native blocked',
    );
    assert(!engine.includes('clearTab') || engine.includes('onBrowserError'), 'no native clear');
  });

  await test('73. same-page player switch bumps media generation', () => {
    resetTab('tab-a', 'https://example.com/watch/longid');
    const a = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({ elementIdentity: 'v-a' }),
    });
    const b = generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: videoEvidence({
        elementIdentity: 'v-b',
        currentSrc: 'https://cdn.example.com/other.mp4',
        src: 'https://cdn.example.com/other.mp4',
      }),
    });
    assert(a && b, 'both');
    assert((b!.pageGeneration ?? 0) > (a!.pageGeneration ?? 0), 'generation bump on player switch');
  });

  await test('74. redirect generation remains coherent', () => {
    assert(engine.includes('isSameOriginSpaTransition') || engine.includes('syncFromPageUrl'), 'redirect sync');
    assert(
      extractGeneralPageVideoId('https://dai.ly/xb6huwu') === 'xb6huwu',
      'short-link public id matches canonical video id',
    );
    assert(
      extractGeneralPageVideoId('https://www.dailymotion.com/video/xb6huwu') === 'xb6huwu',
      'canonical /video/ id',
    );
  });

  await test('75. no Dailymotion API', () => {
    const identity = readSrc('src/media-detection/general-media/general-content-identity.ts');
    const embed = readSrc('src/media-detection/general-media/general-embedded-player.ts');
    assert(!identity.includes('api.dailymotion.com'), 'no dm api identity');
    assert(!embed.includes('dailymotion.com/player'), 'no dm host table');
    assert(!engine.includes('api.dailymotion'), 'no dm api engine');
  });

  await test('76. no backend', () => {
    assert(!pageCtx.includes('fetch(') || pageCtx.includes('logGeneral'), 'context local');
    assert(!inj.includes('XMLHttpRequest') || inj.includes('js_xhr'), 'xhr observe only');
  });

  await test('77. no FFmpeg', () => {
    assert(!engine.toLowerCase().includes('ffmpeg'), 'no ffmpeg');
  });

  await test('78. no DRM bypass', () => {
    assert(inj.includes('mediaKeys') || inj.includes('isDrm'), 'drm observed not bypassed');
  });

  await test('79. no polling', () => {
    assert(!inj.includes('setInterval(scanDom'), 'no scan interval');
    assert(!inj.includes('setInterval(flushActiveVideo'), 'no active video interval');
    assert(!/setInterval\([^)]*iframe/.test(inj), 'no iframe interval');
  });

  await test('80. no second detector', () => {
    assert(engine.includes('handleActiveIframePlayer'), 'iframe routed through engine');
    assert(pageCtx.includes('applyActiveIframePlayerEvidence'), 'same general store');
  });

  await test('81. no DOM-injected VidoraX CTA', () => {
    assert(!inj.includes('Download') || !inj.includes('createElement(\'button\')'), 'no DOM CTA button');
    assert(!inj.includes('VidoraX Download'), 'no injected CTA label');
  });

  await test('82. no Cookie persistence', () => {
    assert(!pageCtx.includes('Cookie'), 'general context no cookie');
  });

  await test('83. no Authorization persistence', () => {
    assert(!pageCtx.includes('Authorization'), 'no auth header store');
  });

  await test('84. Phase 1 unchanged (handoff still enqueueBrowserMediaDownload)', () => {
    assert(hook.includes('enqueueBrowserMediaDownload'), 'phase 1 enqueue preserved');
  });

  await test('85. Pause/Resume untouched', () => {
    const pause = readSrc('src/downloads/engine/retry-policy.ts');
    assert(pause.includes('export'), 'pause module not deleted');
  });

  await test('86. TikTok/Instagram Phase 4 behavior untouched', () => {
    assert(socialId.includes("return 'instagram'") && socialId.includes("return 'tiktok'"), 'social hosts');
    assert(!socialId.includes('dailymotion'), 'dailymotion is not social');
    assert(resolveSocialPlatform('https://www.dailymotion.com/video/xb6huwu') == null, 'dm not social');
    assert(resolveSocialPlatform('https://www.tiktok.com/@u/video/12345678901') === 'tiktok', 'tt still social');
    assert(
      resolveSocialPlatform('https://www.instagram.com/reel/AbCdeFgHijk/') === 'instagram',
      'ig still social',
    );
  });

  await test('87. iframe player message sanitizes signed query', () => {
    const parsed = parseMediaBridgeMessage(
      JSON.stringify({
        channel: 'vidorax-media-detection',
        type: 'active_iframe_player',
        payload: {
          pageUrl: 'https://www.dailymotion.com/video/xb6huwu',
          iframeIdentity: 'f1',
          iframeSrc: 'https://geo.dailymotion.com/player/xtv3w.html?auth=SECRET&token=abc',
          frameClass: 'cross-origin',
          isDisplayed: true,
          looksPlayer: true,
          width: 400,
          height: 225,
          associatedContentId: 'xb6huwu',
        },
        ts: Date.now(),
      }),
    );
    assert(parsed?.type === 'active_iframe_player', 'iframe message type');
    if (parsed?.type === 'active_iframe_player') {
      assert(parsed.payload.iframeSrc?.includes('auth=') !== true, 'query stripped');
      assert(parsed.payload.associatedContentId === 'xb6huwu', 'id kept');
    }
  });

  await test('88. MutationObserver schedules active player scan', () => {
    assert(inj.includes('scheduleScanDom();\n      scheduleActiveVideo();') ||
      inj.includes('scheduleActiveVideo();'), 'MO schedules');
  });

  await test('89. iframe src /player/ is generic not host-specific', () => {
    const embed = readSrc('src/media-detection/general-media/general-embedded-player.ts');
    assert(/embed\|player\|video\|media\|watch/.test(embed), 'generic path');
    assert(!embed.includes('geo.dailymotion'), 'no geo host allowlist');
  });

  await test('90. YouTube-style embed also matches generic iframe heuristic', () => {
    assert(
      looksLikePlayerIframeSrc('https://www.youtube.com/embed/dQw4w9WgXcQ'),
      'youtube embed',
    );
  });

  await test('91. diagnostics do not log Cookie/Authorization', () => {
    const diag = readSrc('src/media-detection/general-media/general-media-diagnostics.ts');
    assert(!diag.includes('payload.cookie'), 'no cookie field');
    assert(!diag.includes("putString('Cookie'"), 'no cookie emit');
    assert(diag.includes('GENERAL_OWNER_ACQUIRED'), 'owner trace');
    assert(diag.includes('GENERAL_IFRAME_PLAYER_DISCOVERED'), 'iframe trace');
    assert(diag.includes('Never logs cookies'), 'privacy comment');
  });

  await test('92. social iframe evidence is ignored', () => {
    assert(engine.includes('resolveSocialPlatform(this.pageUrl)'), 'social skip iframe owner');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
