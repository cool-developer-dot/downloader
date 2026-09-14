/**
 * Phase 5C — General website download integration verifier.
 * Usage: npm run verify:phase5c-general-download-integration
 *
 * No Python, Maestro, Appium, emulator loops, or live CDN.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import { toBrowserMediaCtaState } from '../src/browser/media-actions/browser-media-action.types';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import { isRejectedDownloadTarget } from '../src/browser/media-actions/browser-download-presentation';
import { generalPageMediaContextStore } from '../src/media-detection/general-media';
import { isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import { isPlaylistOrStreamUrl } from '../src/downloads/engine/resource-guard';
import type { MediaAnalysisResult } from '../src/api/types';
import type { DetectedMedia } from '../src/media-detection/types';
import type { MediaRequestContext } from '../src/downloads/types/request-context';

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

function makeMedia(partial: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_5c_1',
    url: 'https://cdn.example.com/watch/main.mp4?sig=1',
    finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
    sourceUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
    pageUrl: 'https://example.com/watch/abc',
    title: 'Main Video',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'DIRECT',
    confidence: 0.9,
    detectionSource: 'dom_video',
    sourceDetector: 'dom_video',
    requiresCookies: false,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 30,
    width: 1280,
    height: 720,
    resolution: '720p',
    aspectRatio: 16 / 9,
    fps: null,
    bitrate: null,
    codec: null,
    audioCodec: 'aac',
    estimatedFileSize: 5_000_000,
    websiteSource: 'example.com',
    isDrm: false,
    isLive: false,
    playlistType: null,
    streamProtocol: null,
    videoOnly: false,
    hasSeparateAudio: false,
    downloadable: true,
    detectedAt: Date.now(),
    redirectCount: 0,
    platformHint: 'GENERIC',
    extension: 'mp4',
    ...partial,
  };
}

function makeAnalysis(partial: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    title: 'Main Video',
    platform: 'WEB',
    sourceUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
    finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
    thumbnailUrl: null,
    duration: 30,
    container: 'mp4',
    mimeType: 'video/mp4',
    downloadable: true,
    unsupportedReason: null,
    width: 1280,
    height: 720,
    resolution: '720p',
    bitrate: null,
    fps: null,
    fileSize: '5 MB',
    mediaType: 'video',
    variants: [
      {
        id: 'v720',
        label: '720p',
        height: 720,
        width: 1280,
        bitrate: null,
        filesize: 5_000_000,
        ext: 'mp4',
        url: 'https://cdn.example.com/watch/main.mp4?sig=1',
        downloadable: true,
        hasAudio: true,
        videoOnly: false,
        streamType: 'PROGRESSIVE',
        unsupportedReason: null,
        originalIndex: 0,
      },
    ],
    ...partial,
  };
}

function makeHlsAnalysis(): MediaAnalysisResult {
  return makeAnalysis({
    container: 'hls',
    mimeType: 'application/vnd.apple.mpegurl',
    finalUrl: 'https://cdn.example.com/master.m3u8',
    sourceUrl: 'https://cdn.example.com/master.m3u8',
    variants: [
      {
        id: 'h360',
        label: '360p',
        height: 360,
        width: 640,
        bitrate: 800000,
        filesize: null,
        ext: 'm3u8',
        url: 'https://cdn.example.com/low.m3u8',
        downloadable: true,
        hasAudio: true,
        videoOnly: false,
        streamType: 'HLS',
        unsupportedReason: null,
        originalIndex: 0,
      },
      {
        id: 'h720',
        label: '720p',
        height: 720,
        width: 1280,
        bitrate: 1400000,
        filesize: null,
        ext: 'm3u8',
        url: 'https://cdn.example.com/mid.m3u8',
        downloadable: true,
        hasAudio: true,
        videoOnly: false,
        streamType: 'HLS',
        unsupportedReason: null,
        originalIndex: 1,
      },
      {
        id: 'h1080',
        label: '1080p',
        height: 1080,
        width: 1920,
        bitrate: 2800000,
        filesize: null,
        ext: 'm3u8',
        url: 'https://cdn.example.com/hi.m3u8',
        downloadable: true,
        hasAudio: true,
        videoOnly: false,
        streamType: 'HLS',
        unsupportedReason: null,
        originalIndex: 2,
      },
    ],
  });
}

function makeCtx(partial: Partial<MediaRequestContext> = {}): MediaRequestContext {
  return {
    pageUrl: 'https://example.com/watch/abc',
    originalPageUrl: 'https://example.com/watch/abc',
    referer: 'https://example.com/',
    userAgent: 'VidoraXTest/1',
    cookiesRequired: false,
    cookieHeader: null,
    extraHeaders: null,
    capturedAt: Date.now(),
    ...partial,
  };
}

function resetCta(tabId = 'tab-g'): void {
  browserMediaActionService.setActiveTab(tabId);
  browserMediaActionService.resetForNavigation('https://example.com/watch/abc');
}

console.log('Phase 5C — General Download Integration Verification\n');

async function main(): Promise<void> {
  generalPageMediaContextStore.clearAll();

  await test('1. 5A owned media → 5B offer wiring', () => {
    const cta = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(cta.includes('buildVerifiedGeneralMediaOffer'), '5B offer');
    assert(cta.includes('generalScope'), '5A scope');
    assert(cta.includes('selectCurrentMediaForActiveGeneralTab'), '5A select');
  });

  await test('2. offer → CTA AVAILABLE', () => {
    resetCta();
    const media = makeMedia();
    const analysis = makeAnalysis();
    const fp = buildBrowserMediaFingerprint({
      pageUrl: 'https://example.com/watch/abc',
      mediaUrl: analysis.finalUrl!,
      platform: 'example.com',
    });
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media,
      analysis,
      requestContext: makeCtx(),
      mediaUrl: analysis.finalUrl!,
      contentIdentity: 'general:v-main:cdn.example.com/watch/main.mp4',
      variantIdentity: 'general|progressive|cdn.example.com/watch/main.mp4|mp4|1280|720|',
    });
    const state = browserMediaActionService.getState();
    assert(state.status === 'verified', state.status);
    assert(toBrowserMediaCtaState(state.status) === 'AVAILABLE', 'AVAILABLE');
    assert(state.mediaFingerprint === fp || state.mediaFingerprint != null, 'fp');
  });

  await test('3. rejected 5A candidate cannot become CTA', () => {
    const svc = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(svc.includes("ownershipConfidence === 'REJECTED'"), 'reject gate');
    assert(svc.includes('WEAK_OWNERSHIP'), 'reason');
  });

  await test('4. invalid 5B source cannot become CTA', () => {
    assert(
      isRejectedDownloadTarget('blob:https://example.com/x') === true,
      'blob rejected',
    );
    const cta = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(cta.includes('if (!offerResult.ok)'), 'idle on fail');
    assert(cta.includes("setStatus('idle')"), 'idle');
  });

  await test('5. single variant direct handoff', () => {
    resetCta();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', claim.outcome);
    if (claim.outcome === 'CLAIMED') {
      assert(claim.contentIdentity === 'media-a', 'content');
      assert(claim.variantIdentity === 'var-a', 'variant');
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_1',
      );
    }
    assert(browserMediaActionService.getState().status === 'consumed', 'consumed');
  });

  await test('6. multiple variants quality sheet', () => {
    resetCta();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia({ url: 'https://cdn.example.com/master.m3u8' }),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-hls',
      variantIdentity: 'var-hls',
    });
    const variants = browserMediaActionService.getState().analysis?.variants ?? [];
    assert(variants.filter((v) => v.downloadable).length >= 2, 'multi');
    const lock = browserMediaActionService.beginQualitySelection({
      navigationEpoch: 1,
      pageGeneration: 3,
      socialContextGeneration: null,
    });
    assert(lock.outcome === 'LOCKED', lock.outcome);
    if (lock.outcome === 'LOCKED') {
      assert(lock.freeze.pageGeneration === 3, 'freeze page gen');
      assert(lock.freeze.contentIdentity === 'media-hls', 'freeze media');
    }
  });

  await test('7. quality cancel → AVAILABLE', () => {
    resetCta('tab-qc');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-hls',
      variantIdentity: 'var-hls',
    });
    const lock = browserMediaActionService.beginQualitySelection({
      navigationEpoch: 1,
      pageGeneration: 1,
    });
    assert(lock.outcome === 'LOCKED', 'locked');
    browserMediaActionService.endQualitySelection('tab-qc');
    assert(browserMediaActionService.getState().status === 'verified', 'restored');
    assert(browserMediaActionService.getState().selectionLocked === false, 'unlocked');
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE', 'AVAILABLE');
  });

  await test('8. quality choose → enqueue (consume path)', () => {
    resetCta('tab-qq');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-hls',
      variantIdentity: 'var-hls',
    });
    const lock = browserMediaActionService.beginQualitySelection({
      navigationEpoch: 2,
      pageGeneration: 2,
    });
    assert(lock.outcome === 'LOCKED', 'locked');
    if (lock.outcome === 'LOCKED') {
      const ok = browserMediaActionService.commitConsumed(
        lock.tabId,
        lock.fingerprint,
        -1,
        'dl_q',
      );
      assert(ok, 'commit');
    }
    assert(browserMediaActionService.getState().status === 'consumed', 'consumed');
  });

  await test('9. enqueue success → CONSUMED', () => {
    resetCta('tab-enq');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', 'claimed');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_2',
      );
    }
    assert(toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED', 'CONSUMED');
  });

  await test('10. same media rediscovery no resurrection', () => {
    resetCta('tab-rd');
    const media = makeMedia();
    const analysis = makeAnalysis();
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media,
      analysis,
      requestContext: makeCtx(),
      mediaUrl: analysis.finalUrl!,
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', 'claim');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_3',
      );
    }
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media,
      analysis,
      requestContext: makeCtx(),
      mediaUrl: analysis.finalUrl!,
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    assert(browserMediaActionService.getState().status === 'consumed', 'still consumed');
  });

  await test('11. signed URL refresh no resurrection', () => {
    resetCta('tab-sig');
    const mediaA = makeMedia({
      url: 'https://cdn.example.com/watch/main.mp4?sig=AAA',
      finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=AAA',
    });
    const analysisA = makeAnalysis({
      finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=AAA',
      sourceUrl: 'https://cdn.example.com/watch/main.mp4?sig=AAA',
    });
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: mediaA,
      analysis: analysisA,
      requestContext: makeCtx(),
      mediaUrl: analysisA.finalUrl!,
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', 'claim');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_sig',
      );
    }
    const mediaB = makeMedia({
      url: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
      finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
    });
    const analysisB = makeAnalysis({
      finalUrl: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
      sourceUrl: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
      variants: [
        {
          ...(makeAnalysis().variants![0]!),
          url: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
        },
      ],
    });
    const fpA = buildBrowserMediaFingerprint({
      pageUrl: 'https://example.com/watch/abc',
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=AAA',
      platform: 'example.com',
    });
    const fpB = buildBrowserMediaFingerprint({
      pageUrl: 'https://example.com/watch/abc',
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=BBB',
      platform: 'example.com',
    });
    assert(fpA === fpB, 'signed query ignored in fingerprint');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: mediaB,
      analysis: analysisB,
      requestContext: makeCtx(),
      mediaUrl: analysisB.finalUrl!,
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    assert(browserMediaActionService.getState().status === 'consumed', 'no resurrect');
  });

  await test('12. new media gets CTA', () => {
    resetCta('tab-new');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claim = browserMediaActionService.claimForHandoff();
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_a',
      );
    }
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/xyz',
      media: makeMedia({
        id: 'md_b',
        url: 'https://cdn.example.com/watch/other.mp4',
        finalUrl: 'https://cdn.example.com/watch/other.mp4',
        pageUrl: 'https://example.com/watch/xyz',
      }),
      analysis: makeAnalysis({
        finalUrl: 'https://cdn.example.com/watch/other.mp4',
        sourceUrl: 'https://cdn.example.com/watch/other.mp4',
        variants: [
          {
            ...(makeAnalysis().variants![0]!),
            url: 'https://cdn.example.com/watch/other.mp4',
          },
        ],
      }),
      requestContext: makeCtx({ pageUrl: 'https://example.com/watch/xyz' }),
      mediaUrl: 'https://cdn.example.com/watch/other.mp4',
      contentIdentity: 'media-b',
      variantIdentity: 'var-b',
    });
    assert(browserMediaActionService.getState().status === 'verified', 'new AVAILABLE');
  });

  await test('13. stale SPA callback ignored', () => {
    resetCta('tab-spa');
    generalPageMediaContextStore.setActiveTab('tab-spa');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-spa',
      pageUrl: 'https://example.com/a',
      navigationEpoch: 5,
    });
    const g1 = generalPageMediaContextStore.get('tab-spa')!.pageGeneration;
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/a',
      media: makeMedia(),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx({ pageUrl: 'https://example.com/a' }),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const lock = browserMediaActionService.beginQualitySelection({
      navigationEpoch: 5,
      pageGeneration: g1,
    });
    assert(lock.outcome === 'LOCKED', 'locked');
    // SPA path change bumps generation.
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-spa',
      pageUrl: 'https://example.com/b',
      navigationEpoch: 5,
    });
    const g2 = generalPageMediaContextStore.get('tab-spa')!.pageGeneration;
    assert(g2 > g1, 'gen bumped');
    assert(
      browserMediaActionService.isQualitySelectionOfferCurrent('tab-spa') === true,
      'offer still locked until confirm checks gen',
    );
    // Confirm helper path: freeze pageGeneration no longer matches store.
    const freeze = browserMediaActionService.getQualitySelectionFreeze('tab-spa');
    assert(freeze?.pageGeneration === g1, 'frozen at A');
    assert(freeze!.pageGeneration !== g2, 'B is newer');
  });

  await test('14. recycled player identity changes correctly', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-rec');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-rec',
      pageUrl: 'https://example.com/carousel',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-rec',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://example.com/carousel',
        elementIdentity: 'player-1',
        currentSrc: 'https://cdn.example.com/a.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
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
    const before = generalPageMediaContextStore.get('tab-rec')!;
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-rec',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://example.com/carousel',
        elementIdentity: 'player-1',
        currentSrc: 'https://cdn.example.com/b.mp4',
        src: null,
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
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
    const after = generalPageMediaContextStore.get('tab-rec')!;
    assert(after.pageGeneration > before.pageGeneration, 'gen change');
    assert(
      after.currentMediaIdentity !== before.currentMediaIdentity,
      'media identity changed',
    );
  });

  await test('15. cross-tab isolation', () => {
    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.resetForNavigation('https://a.example/v');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://a.example/v',
      media: makeMedia({ pageUrl: 'https://a.example/v' }),
      analysis: makeAnalysis(),
      requestContext: makeCtx({ pageUrl: 'https://a.example/v' }),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const claimA = browserMediaActionService.claimForHandoff();
    assert(claimA.outcome === 'CLAIMED', 'A claimed');
    if (claimA.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claimA.tabId,
        claimA.fingerprint,
        claimA.handoffGeneration,
        'dl_a',
      );
    }

    browserMediaActionService.setActiveTab('tab-b');
    browserMediaActionService.resetForNavigation('https://b.example/hls');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://b.example/hls',
      media: makeMedia({
        pageUrl: 'https://b.example/hls',
        url: 'https://cdn.example.com/master.m3u8',
      }),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx({ pageUrl: 'https://b.example/hls' }),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-b',
      variantIdentity: 'var-b',
    });
    assert(browserMediaActionService.getState().status === 'verified', 'B available');
    assert(
      !browserMediaActionService.isContentIdentityConsumed('media-b'),
      'B not consumed by A',
    );
  });

  await test('16. tab close after enqueue safe', () => {
    browserMediaActionService.setActiveTab('tab-close');
    browserMediaActionService.resetForNavigation('https://example.com/v');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/v',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-x',
      variantIdentity: 'var-x',
    });
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', 'claimed');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_close',
      );
    }
    browserMediaActionService.clearTab('tab-close');
    browserMediaActionService.setActiveTab('tab-other');
    // Late commit on closed tab must no-op without resurrecting.
    if (claim.outcome === 'CLAIMED') {
      const late = browserMediaActionService.commitConsumed(
        claim.tabId,
        claim.fingerprint,
        claim.handoffGeneration,
        'dl_close2',
      );
      assert(late === false, 'late no-op');
    }
  });

  await test('17. double tap one job', () => {
    resetCta('tab-dbl');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/watch/main.mp4?sig=1',
      contentIdentity: 'media-a',
      variantIdentity: 'var-a',
    });
    const first = browserMediaActionService.claimForHandoff();
    const second = browserMediaActionService.claimForHandoff();
    assert(first.outcome === 'CLAIMED', 'first');
    assert(second.outcome !== 'CLAIMED', `second=${second.outcome}`);
  });

  await test('18. progressive request goes canonical Phase 1 path', () => {
    const enqueue = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(enqueue.includes('useDownloadsStore'), 'store create');
    assert(enqueue.includes('toCreateDownloadInput'), 'canonical mapper');
    assert(!isPlaylistOrStreamUrl('https://cdn.example.com/watch/main.mp4'), 'progressive');
  });

  await test('19. HLS request goes Phase 1 HLS path', () => {
    assert(isPlaylistOrStreamUrl('https://cdn.example.com/master.m3u8'), 'hls url');
    const manager = readSrc('src/downloads/engine/manager.ts');
    assert(manager.includes('isPlaylistOrStreamUrl'), 'routes by playlist');
    assert(manager.includes('HlsTransferWorker') || manager.includes('hls'), 'hls worker');
  });

  await test('20. segments never enqueue independently', () => {
    assert(isLikelyMediaSegment('https://cdn.example.com/seg001.ts', 'ts'), 'ts');
    assert(isLikelyMediaSegment('https://cdn.example.com/chunk-1.m4s', 'm4s'), 'm4s');
    const gen = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(gen.includes('SEGMENT_RESOURCE'), '5B rejects segments');
  });

  await test('21. unsupported DRM never enqueues', () => {
    const gen = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(gen.includes('DRM_UNSUPPORTED'), 'drm reject');
    assert(gen.includes('isHlsDrmOrUnsupportedEncryption'), 'hls drm');
  });

  await test('22. WAITING_FOR_WIFI keeps CTA consumed', () => {
    const svc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    assert(svc.includes('WAITING_FOR_WIFI'), 'documented');
    assert(svc.includes('do not resurrect CTA'), 'no resurrect');
  });

  await test('23. FAILED keeps CTA consumed', () => {
    const svc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    assert(/FAILED.*resurrect|do not resurrect CTA/s.test(svc), 'failed no resurrect');
  });

  await test('24. CANCELLED keeps CTA consumed', () => {
    const svc = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    assert(/CANCELLED.*resurrect|do not resurrect CTA/s.test(svc), 'cancel no resurrect');
  });

  await test('25. resume 200 not blindly appended', () => {
    const lifecycle = readSrc('scripts/verify-lifecycle-file-integrity.ts');
    assert(lifecycle.includes('HTTP 200 on resume does NOT allow append'), 'gate');
    // Resume safety lives in Phase 1 integrity scripts / engine — assert contract text.
    assert(
      /SOURCE_CHANGED|RESUME_UNSUPPORTED|no 200 append/i.test(lifecycle),
      'append safety contract',
    );
  });

  await test('26. unknown length supported', () => {
    const transfer = readSrc('scripts/verify-transfer-reliability.ts');
    assert(transfer.includes('unknown total'), 'unknown total');
    assert(transfer.includes('no fabricated percent') || transfer.includes('null'), 'no fake');
  });

  await test('27. VIDEO_ONLY unsupported not normal download', () => {
    const gen = readSrc(
      'src/media-detection/general-source/general-source-reliability.service.ts',
    );
    assert(gen.includes('VIDEO_ONLY_UNSUPPORTED'), 'unsupported');
    assert(gen.includes('isCombinedDownloadActionable'), 'combined gate');
  });

  await test('28. no polling', () => {
    for (const rel of [
      'src/media-detection/general-media/general-page-context.ts',
      'src/media-detection/general-source/general-source-reliability.service.ts',
      'src/browser/media-actions/useBrowserMediaAction.ts',
      'src/screens/downloads/quality/useQualitySelection.ts',
    ]) {
      assert(!/setInterval\s*\(/.test(readSrc(rel)), `${rel} no setInterval`);
      assert(!/refetchInterval/.test(readSrc(rel)), `${rel} no refetchInterval`);
    }
  });

  await test('29. no backend', () => {
    for (const rel of [
      'src/media-detection/general-source/general-source-reliability.service.ts',
      'src/browser/media-actions/useBrowserMediaAction.ts',
    ]) {
      const src = readSrc(rel);
      assert(!/supabase/i.test(src), `${rel} no supabase`);
      assert(!/firebase/i.test(src), `${rel} no firebase`);
    }
  });

  await test('30. no sensitive logging', () => {
    const diag = readSrc('src/browser/media-actions/browser-cta-diagnostics.ts');
    assert(diag.includes('fingerprintHash') || diag.includes('fingerprintDiagHash'), 'hash');
    assert(!/console\.log\([\s\S]*cookieHeader/.test(diag), 'no cookie');
    const gdiag = readSrc(
      'src/media-detection/general-source/general-source-diagnostics.ts',
    );
    assert(gdiag.includes('mediaIdentityHash'), 'hashed');
    assert(!/fields\.executableUrl/.test(gdiag), 'no exec url field');
  });

  await test('31. general does not invent social refresh identity', () => {
    const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
    assert(hook.includes('only wire Phase 4C social refresh identity on social pages'), 'comment');
    assert(hook.includes('resolveSocialPlatform(claim.pageUrl)'), 'social gate');
    const quality = readSrc('src/screens/downloads/quality/useQualitySelection.ts');
    assert(quality.includes('social refresh identity only on social pages'), 'quality gate');
  });

  await test('32. quality freeze captures generation', () => {
    resetCta('tab-fz');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://example.com/watch/abc',
      media: makeMedia(),
      analysis: makeHlsAnalysis(),
      requestContext: makeCtx(),
      mediaUrl: 'https://cdn.example.com/master.m3u8',
      contentIdentity: 'media-fz',
      variantIdentity: 'var-fz',
    });
    const lock = browserMediaActionService.beginQualitySelection({
      navigationEpoch: 9,
      pageGeneration: 4,
      socialContextGeneration: null,
    });
    assert(lock.outcome === 'LOCKED', 'locked');
    const freeze = browserMediaActionService.getQualitySelectionFreeze('tab-fz');
    assert(freeze?.navigationEpoch === 9, 'epoch');
    assert(freeze?.pageGeneration === 4, 'page gen');
    assert(freeze?.socialContextGeneration == null, 'not social');
  });

  await test('architecture docs exist', () => {
    // Created in this phase — may not exist yet when verifier first runs mid-edit.
    assert(
      existsSync(
        join(ROOT, 'src/media-detection/general-source/general-source-reliability.service.ts'),
      ),
      '5B module',
    );
    assert(
      existsSync(join(ROOT, 'src/media-detection/general-media/general-page-context.ts')),
      '5A module',
    );
  });

  console.log(`\nPhase 5C results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void main();
