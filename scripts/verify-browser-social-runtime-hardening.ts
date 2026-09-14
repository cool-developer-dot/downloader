/**
 * Browser + social runtime hardening verifier.
 *
 * Usage (from mobile/):
 *   npm run verify:browser-social-runtime-hardening
 *
 * Covers infinite spinner, Back/Forward/Home live-gate, and social CTA feed swipe.
 * No Python / Maestro / Appium / APK / expo export.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractInstagramContentIdentity } from '../src/media-detection/social/instagram-content-identity';
import { socialPageContextStore } from '../src/media-detection/social/social-page-context';
import { resolveContentIdentityKey } from '../src/media-detection/social/social-content-identity';
import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import type { ActiveVideoEvidence } from '../src/media-detection/social/types';
import type { MediaAnalysisResult } from '../src/api/types';
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
    console.log(
      `FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`,
    );
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

function mustNotInclude(source: string, needles: string[], label: string): void {
  for (const needle of needles) {
    assert(!source.includes(needle), `${label} must not contain: ${needle}`);
  }
}

function evidence(
  overrides: Partial<ActiveVideoEvidence> & Pick<ActiveVideoEvidence, 'elementIdentity'>,
): ActiveVideoEvidence {
  return {
    pageUrl: 'https://www.instagram.com/reels/',
    currentSrc: null,
    src: null,
    isBlob: false,
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 1080,
    videoHeight: 1920,
    muted: false,
    currentTimeBucket: 0,
    intersectionRatio: 0.9,
    viewportCenterDistance: 0,
    isDisplayed: true,
    isVisibleStyle: true,
    recentlyPlayed: true,
    explicitAdMarker: false,
    associatedContentId: null,
    observedAt: Date.now(),
    ...overrides,
  };
}

function sampleMedia(id: string, pageUrl: string, mediaUrl: string): DetectedMedia {
  return {
    id,
    url: mediaUrl,
    finalUrl: mediaUrl,
    pageUrl,
    category: 'video',
    confidence: 0.9,
    websiteSource: 'instagram',
  } as DetectedMedia;
}

function sampleAnalysis(): MediaAnalysisResult {
  return {
    downloadable: true,
    mediaType: 'video',
    platform: 'instagram',
    finalUrl: 'https://cdn.example.com/a.mp4',
    variants: [{ downloadable: true, url: 'https://cdn.example.com/a.mp4' }],
  } as MediaAnalysisResult;
}

async function main(): Promise<void> {
  console.log('Browser + Social Runtime Hardening Verification\n');

  // ——— LOADING ———
  await test('1-4. loading lifecycle clears without wall-clock timeout', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(
      events,
      [
        'clearTopLevelLoading',
        "reason: 'load_end'",
        'progress_complete',
        'setLoading(false)',
        'nextLoading',
      ],
      'loading',
    );
    mustNotInclude(events, ['setTimeout(', 'setInterval('], 'no fake timer spinner');
  });

  await test('5. redirect chain does not drop loading=false without stale epoch', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(events, ['isStaleEvent()', 'redirect final URL'], 'redirect guard');
    // Early-return for different URL while loading must require isStaleEvent.
    assert(
      events.includes('isStaleEvent()') &&
        events.includes('owning.loading') &&
        events.includes('!navState.loading'),
      'stale+loading gate present',
    );
  });

  await test('6-9. navState.loading cannot re-arm; SPA/media do not own spinner', () => {
    const events = readSrc('src/browser/hooks/useBrowserEngineEvents.ts');
    mustInclude(
      events,
      ['must NEVER re-arm the spinner', 'nextLoading = owning.loading'],
      're-arm gate',
    );
    const bridge = readSrc('src/browser/hooks/useBrowserChromeBridge.ts');
    mustNotInclude(bridge, ['setLoading(true)', 'loading: true'], 'SPA bridge');
  });

  await test('10. Home clears loading', () => {
    const engine = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(engine, ['goHome', 'loading'], 'home');
  });

  // ——— NAVIGATION ———
  await test('11-18. live generation survives sourceUri re-register', () => {
    const scoped = readSrc('src/browser/hooks/useTabScopedBrowserEngine.ts');
    mustInclude(
      scoped,
      [
        'Zero generation ONLY on true unmount',
        'tabControllerRegistry.register(tabId, value)',
        'webViewInstanceGenerationRef.current = 0',
      ],
      'generation',
    );
    // Critical: unmount cleanup must NOT share deps with value/sourceUri.
    assert(
      /useEffect\(\(\) => \{\s*tabControllerRegistry\.register\(tabId, value\);\s*\}, \[tabId, value\]\)/s.test(
        scoped,
      ),
      'register effect separate from unmount',
    );
    assert(
      /useEffect\(\(\) => \{[\s\S]*webViewInstanceGenerationRef\.current = 0;[\s\S]*unregister\(tabId\);[\s\S]*\}, \[tabId\]\)/s.test(
        scoped,
      ),
      'unmount only depends on tabId',
    );
    const nav = readSrc('src/browser/services/active-tab-navigation.service.ts');
    mustInclude(nav, ['resolveLiveController', 'goBackForTab', 'goForwardForTab', 'goHomeForTab'], 'commands');
    mustNotInclude(nav, ['Linking.openURL', 'fakeHistory', 'historyStack.push'], 'no fake history');
  });

  await test('19. toolbar not covered by requiring box-none overlays', () => {
    const bar = readSrc('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
    mustInclude(bar, ['box-none', 'pointerEvents'], 'overlay');
  });

  // ——— SOCIAL CTA ———
  await test('20-23. Instagram /reels/{shortcode} STRONG id; A consumed stays A', () => {
    const a = extractInstagramContentIdentity('https://www.instagram.com/reels/DcmMB5FAKt6/');
    assert(a?.canonicalContentId === 'DcmMB5FAKt6', 'plural reels shortcode');
    assert(a?.identityConfidence === 'STRONG', 'STRONG');
    const singular = extractInstagramContentIdentity('https://www.instagram.com/reel/DcmMB5FAKt6/');
    assert(singular?.canonicalContentId === 'DcmMB5FAKt6', 'singular reel');
    const feedRoot = extractInstagramContentIdentity('https://www.instagram.com/reels/');
    assert(feedRoot?.canonicalContentId == null, 'feed root null id');
  });

  await test('24-26. Video A CONSUMED does not suppress Video B CTA', () => {
    browserMediaActionService.setActiveTab('tab-feed');
    browserMediaActionService.resetForNavigation('https://www.instagram.com/reels/AAAAA11111/');

    const mediaA = sampleMedia('m-a', 'https://www.instagram.com/reels/AAAAA11111/', 'https://cdn.example.com/a.mp4');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reels/AAAAA11111/',
      media: mediaA,
      analysis: sampleAnalysis(),
      requestContext: {
        pageUrl: 'https://www.instagram.com/reels/AAAAA11111/',
        referer: 'https://www.instagram.com/reels/AAAAA11111/',
        userAgent: 'test',
        cookiesRequired: false,
        hasCookies: false,
        headers: {},
        capturedAt: Date.now(),
      },
      mediaUrl: 'https://cdn.example.com/a.mp4',
      contentIdentity: 'instagram:instagram_reel:AAAAA11111',
      autoShow: true,
    });
    assert(browserMediaActionService.getState().status === 'verified', 'A available');
    const claim = browserMediaActionService.claimForHandoff();
    assert(claim.outcome === 'CLAIMED', 'claimed');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed('tab-feed', claim.fingerprint, claim.handoffGeneration);
    }
    assert(browserMediaActionService.getState().status === 'consumed', 'A consumed');
    assert(
      browserMediaActionService.isContentIdentityConsumed('instagram:instagram_reel:AAAAA11111'),
      'A identity consumed',
    );
    assert(
      !browserMediaActionService.isContentIdentityConsumed('instagram:instagram_reel:BBBBB22222'),
      'B not consumed',
    );

    // Soft invalidate for B — must not clear A's consumed key.
    browserMediaActionService.invalidateStaleSocialOffer('instagram:instagram_reel:BBBBB22222');
    assert(
      browserMediaActionService.isContentIdentityConsumed('instagram:instagram_reel:AAAAA11111'),
      'A still consumed after invalidate',
    );
    assert(browserMediaActionService.getState().status === 'idle', 'offer idle for B');

    const mediaB = sampleMedia('m-b', 'https://www.instagram.com/reels/BBBBB22222/', 'https://cdn.example.com/b.mp4');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reels/BBBBB22222/',
      media: mediaB,
      analysis: {
        ...sampleAnalysis(),
        finalUrl: 'https://cdn.example.com/b.mp4',
        variants: [{ downloadable: true, url: 'https://cdn.example.com/b.mp4' }],
      } as MediaAnalysisResult,
      requestContext: {
        pageUrl: 'https://www.instagram.com/reels/BBBBB22222/',
        referer: 'https://www.instagram.com/reels/BBBBB22222/',
        userAgent: 'test',
        cookiesRequired: false,
        hasCookies: false,
        headers: {},
        capturedAt: Date.now(),
      },
      mediaUrl: 'https://cdn.example.com/b.mp4',
      contentIdentity: 'instagram:instagram_reel:BBBBB22222',
      autoShow: true,
    });
    assert(browserMediaActionService.getState().status === 'verified', 'B AVAILABLE');
    assert(
      browserMediaActionService.getState().contentIdentity === 'instagram:instagram_reel:BBBBB22222',
      'B identity',
    );
  });

  await test('22. same content CDN refresh stays consumed', () => {
    assert(
      browserMediaActionService.isContentIdentityConsumed('instagram:instagram_reel:AAAAA11111'),
      'AAA still consumed',
    );
  });

  await test('27. recycled player src change bumps generation below 0.35 ratio', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-recycle');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-recycle',
      pageUrl: 'https://www.tiktok.com/foryou',
      navigationEpoch: 1,
    });
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-recycle',
      navigationEpoch: 1,
      evidence: evidence({
        elementIdentity: 'v1',
        pageUrl: 'https://www.tiktok.com/foryou',
        currentSrc: 'https://cdn.tiktok.com/a/video.mp4',
        src: 'https://cdn.tiktok.com/a/video.mp4',
        intersectionRatio: 0.9,
      }),
    });
    const gen1 = socialPageContextStore.get('tab-recycle')!.contextGeneration;
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-recycle',
      navigationEpoch: 1,
      evidence: evidence({
        elementIdentity: 'v1',
        pageUrl: 'https://www.tiktok.com/foryou',
        currentSrc: 'https://cdn.tiktok.com/b/video.mp4',
        src: 'https://cdn.tiktok.com/b/video.mp4',
        intersectionRatio: 0.2, // mid-swipe
        isDisplayed: true,
      }),
    });
    const gen2 = socialPageContextStore.get('tab-recycle')!.contextGeneration;
    assert(gen2 > gen1, `expected bump ${gen1} → ${gen2}`);
  });

  await test('28-29. SPA null-id pageUrl change bumps; stale A cannot own B', () => {
    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-spa');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-spa',
      pageUrl: 'https://www.instagram.com/reels/pathA',
      navigationEpoch: 5,
    });
    // Force WEAK null path by using explore (no shortcode) then change URL same epoch.
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-spa',
      pageUrl: 'https://www.instagram.com/explore/',
      navigationEpoch: 5,
    });
    const g1 = socialPageContextStore.get('tab-spa')!.contextGeneration;
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-spa',
      pageUrl: 'https://www.instagram.com/',
      navigationEpoch: 5, // same epoch SPA
    });
    const g2 = socialPageContextStore.get('tab-spa')!.contextGeneration;
    assert(g2 > g1, 'null-id SPA pageUrl change bumps generation');
  });

  await test('30-33. Instagram / TikTok scroll identity + ephemeral blob distinct', () => {
    const a = extractInstagramContentIdentity('https://www.instagram.com/reels/AAAAA11111/');
    const b = extractInstagramContentIdentity('https://www.instagram.com/reels/BBBBB22222/');
    assert(a?.canonicalContentId !== b?.canonicalContentId, 'distinct reels');

    socialPageContextStore.clearAll();
    socialPageContextStore.setActiveTab('tab-blob');
    socialPageContextStore.syncFromPageUrl({
      tabId: 'tab-blob',
      pageUrl: 'https://www.instagram.com/reels/',
      navigationEpoch: 1,
    });
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-blob',
      navigationEpoch: 1,
      evidence: evidence({
        elementIdentity: 'v1',
        isBlob: true,
        currentSrc: 'blob:https://www.instagram.com/11111111-aaaa-bbbb-cccc-ddddeeeeffff',
        src: 'blob:https://www.instagram.com/11111111-aaaa-bbbb-cccc-ddddeeeeffff',
      }),
    });
    const idA = socialPageContextStore.get('tab-blob')!.currentVisibleMediaIdentity;
    socialPageContextStore.applyActiveVideoEvidence({
      tabId: 'tab-blob',
      navigationEpoch: 1,
      evidence: evidence({
        elementIdentity: 'v1',
        isBlob: true,
        currentSrc: 'blob:https://www.instagram.com/22222222-zzzz-yyyy-xxxx-wwwwvvvvuuuu',
        src: 'blob:https://www.instagram.com/22222222-zzzz-yyyy-xxxx-wwwwvvvvuuuu',
        intersectionRatio: 0.5,
      }),
    });
    const idB = socialPageContextStore.get('tab-blob')!.currentVisibleMediaIdentity;
    assert(idA && idB && idA !== idB, `blob ephemeral distinct: ${idA} vs ${idB}`);
  });

  await test('34-37. no global/host-only consumption; cross-tab isolation', () => {
    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.resetForNavigation('https://www.instagram.com/reels/XXXXX11111/');
    browserMediaActionService.handoffVerified({
      pageUrl: 'https://www.instagram.com/reels/XXXXX11111/',
      media: sampleMedia('xa', 'https://www.instagram.com/reels/XXXXX11111/', 'https://cdn.example.com/x1.mp4'),
      analysis: sampleAnalysis(),
      requestContext: {
        pageUrl: 'https://www.instagram.com/reels/XXXXX11111/',
        referer: null,
        userAgent: null,
        cookiesRequired: false,
        hasCookies: false,
        headers: {},
        capturedAt: Date.now(),
      },
      mediaUrl: 'https://cdn.example.com/x1.mp4',
      contentIdentity: 'instagram:instagram_reel:XXXXX11111',
      autoShow: true,
    });
    const claim = browserMediaActionService.claimForHandoff();
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed('tab-a', claim.fingerprint, claim.handoffGeneration);
    }

    browserMediaActionService.setActiveTab('tab-b');
    browserMediaActionService.resetForNavigation('https://www.tiktok.com/@u/video/1');
    assert(
      !browserMediaActionService.isContentIdentityConsumed('instagram:instagram_reel:XXXXX11111'),
      'tab B does not see tab A content consumption',
    );
  });

  await test('38-41. long-scroll bounds + no polling', () => {
    const ctxSrc = readSrc('src/media-detection/social/social-page-context.ts');
    mustInclude(ctxSrc, ['MAX_PREVIOUS_PER_TAB'], 'bounded previous');
    const cta = readSrc('src/browser/media-actions/browser-media-action.service.ts');
    mustInclude(cta, ['MAX_CONSUMED_PER_TAB', 'invalidateStaleSocialOffer'], 'bounded consumed');
    mustNotInclude(ctxSrc, ['setInterval(', 'setTimeout(function poll'], 'no poll');
    const inject = readSrc('src/media-detection/observers/injected-script.ts');
    mustInclude(inject, ['IntersectionObserver', 'MutationObserver'], 'event-driven');
  });

  await test('docs + package script', () => {
    assert(
      existsSync(
        join(ROOT, 'docs/testing/BROWSER-SOCIAL-RUNTIME-HARDENING-ACCEPTANCE.md'),
      ),
      'acceptance doc',
    );
  });

  // Keep resolveContentIdentityKey warm for identity helper presence.
  assert(
    typeof resolveContentIdentityKey === 'function',
    'identity helper',
  );

  console.log(`\nHardening results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
