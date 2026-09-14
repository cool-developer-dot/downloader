/**
 * Phase 3F — Browser CTA lifecycle verifier.
 * Run: npm run verify:browser-cta-lifecycle
 *
 * Code/static checks only — no emulator, no Python, no polling loops.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import {
  initialBrowserMediaActionState,
  toBrowserMediaCtaState,
} from '../src/browser/media-actions/browser-media-action.types';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import { buildBrowserDownloadPresentation } from '../src/browser/media-actions/browser-download-presentation';
import type { DetectedMedia } from '../src/media-detection/types';
import type { MediaAnalysisResult } from '../src/api/types';

const root = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    failed += 1;
    console.error(`FAIL: ${message}`);
    return;
  }
  passed += 1;
  console.log(`PASS: ${message}`);
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function makeMedia(overrides: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_cta_1',
    url: 'https://cdn.example.com/video.mp4',
    finalUrl: 'https://cdn.example.com/video.mp4',
    sourceUrl: null,
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    title: 'Sample',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.8,
    detectionSource: 'native_network',
    requiresCookies: false,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 10,
    width: 720,
    height: 1280,
    resolution: '720x1280',
    bitrate: null,
    codec: null,
    audioCodec: null,
    estimatedFileSize: 5_000_000,
    websiteSource: 'tiktok.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<MediaAnalysisResult> = {}): MediaAnalysisResult {
  return {
    title: 'Sample',
    platform: 'tiktok',
    sourceUrl: 'https://cdn.example.com/video.mp4',
    finalUrl: 'https://cdn.example.com/video.mp4',
    thumbnailUrl: null,
    duration: 10,
    container: 'mp4',
    resolution: '720x1280',
    fileSize: '5000000',
    mediaType: 'video',
    downloadable: true,
    variants: [
      {
        id: 'v1',
        label: '720p',
        height: 720,
        width: 1280,
        downloadable: true,
        estimatedFileSize: 5_000_000,
        url: 'https://cdn.example.com/video.mp4',
      },
    ],
    ...overrides,
  } as MediaAnalysisResult;
}

function offerVerified(media = makeMedia()) {
  const mediaUrl = media.finalUrl ?? media.url;
  const platform = 'tiktok';
  browserMediaActionService.handoffVerified({
    pageUrl: media.pageUrl!,
    media,
    analysis: makeAnalysis({
      sourceUrl: mediaUrl,
      finalUrl: mediaUrl,
      platform,
    }),
    requestContext: {
      pageUrl: media.pageUrl!,
      referer: media.pageUrl!,
      userAgent: 'test',
      headers: {},
    },
    mediaUrl,
    autoShow: true,
  });
  return (
    browserMediaActionService.getState().mediaFingerprint ??
    buildBrowserMediaFingerprint({
      pageUrl: media.pageUrl!,
      mediaUrl,
      platform,
    })
  );
}

function presentationVisible(): boolean {
  const actionState = browserMediaActionService.getState();
  const presentation = buildBrowserDownloadPresentation({
    actionState,
    activeTabId: browserMediaActionService.getActiveTabId(),
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: actionState.pageUrl,
    hasDownloadableOptions: true,
  });
  return presentation.showCard;
}

console.log('Phase 3F — Browser CTA lifecycle verifier\n');

browserMediaActionService.__resetAllForTests();

// --- 1. NONE → AVAILABLE ---
{
  browserMediaActionService.resetForNavigation(null);
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'NONE',
    '1. initial → NONE',
  );
  const fp = offerVerified();
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '1. verified media → AVAILABLE',
  );
  assert(presentationVisible(), '1. AVAILABLE → CTA visible');
  assert(fp.length > 0, '1. fingerprint built');
}

// --- 2–3. Atomic claim + duplicate rejected ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified();
  const claim1 = browserMediaActionService.claimForHandoff();
  assert(claim1.outcome === 'CLAIMED', '2. AVAILABLE → claim CLAIMED');
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) ===
      'HANDOFF_IN_PROGRESS',
    '2. claim → HANDOFF_IN_PROGRESS atomically',
  );
  const claim2 = browserMediaActionService.claimForHandoff();
  assert(claim2.outcome === 'ALREADY_IN_PROGRESS', '3. duplicate claim rejected');
  assert(
    browserMediaActionService.__getPendingHandoffCountForTests() === 1,
    '3. exactly one pending handoff',
  );
}

// --- 4–5. success → CONSUMED hides presentation ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fp = offerVerified();
  const claim = browserMediaActionService.claimForHandoff();
  assert(claim.outcome === 'CLAIMED', '4. claim for success path');
  if (claim.outcome === 'CLAIMED') {
    const ok = browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_ok',
    );
    assert(ok, '4. commitConsumed succeeds');
  }
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED',
    '4. success → CONSUMED',
  );
  assert(!presentationVisible(), '5. CONSUMED hides presentation');
  assert(browserMediaActionService.isFingerprintConsumed(fp), '5. fingerprint consumed');
}

// --- 6. immediate failure → AVAILABLE ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified();
  const claim = browserMediaActionService.claimForHandoff();
  assert(claim.outcome === 'CLAIMED', '6. claim before failure');
  if (claim.outcome === 'CLAIMED') {
    browserMediaActionService.releaseHandoff(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'Could not start download.',
    );
  }
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '6. immediate failure → AVAILABLE',
  );
  assert(presentationVisible(), '6. failure restores visibility');
}

// --- 7–8. Phase 1 FAILED/CANCELLED do not resurrect (no store coupling) ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fp = offerVerified();
  const claim = browserMediaActionService.claimForHandoff();
  if (claim.outcome === 'CLAIMED') {
    browserMediaActionService.commitConsumed(
      claim.tabId,
      claim.fingerprint,
      claim.handoffGeneration,
      'dl_1',
    );
  }
  // Simulate Phase 1 later FAILED / CANCELLED — CTA API has no resurrect path.
  browserMediaActionService.markCompleted('dl_1');
  offerVerified();
  assert(
    browserMediaActionService.getState().status === 'consumed',
    '7. post-enqueue Phase 1 status changes do not resurrect',
  );
  assert(
    browserMediaActionService.isFingerprintConsumed(fp),
    '8. cancelled/failed job identity stays consumed',
  );
  assert(!presentationVisible(), '8. CTA remains hidden');
}

// --- 9. same fingerprint rediscovery suppressed ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fp = offerVerified();
  browserMediaActionService.markConsumed(fp);
  offerVerified(makeMedia({ id: 'md_rediscover', detectionSource: 'dom' }));
  assert(
    browserMediaActionService.getState().status === 'consumed',
    '9. same fingerprint rediscovery suppressed',
  );
}

// --- 10. new fingerprint available ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fpA = offerVerified(
    makeMedia({
      id: 'md_a',
      url: 'https://cdn.example.com/a.mp4',
      finalUrl: 'https://cdn.example.com/a.mp4',
    }),
  );
  browserMediaActionService.markConsumed(fpA);
  offerVerified(
    makeMedia({
      id: 'md_b',
      url: 'https://cdn.example.com/b.mp4',
      finalUrl: 'https://cdn.example.com/b.mp4',
    }),
  );
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '10. new fingerprint → AVAILABLE',
  );
}

// --- 11. navigation identity isolation ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fp = offerVerified();
  browserMediaActionService.markConsumed(fp);
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@other/video/999');
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'NONE',
    '11. new navigation clears prior offer',
  );
  offerVerified(
    makeMedia({
      id: 'md_new_page',
      pageUrl: 'https://www.tiktok.com/@other/video/999',
    }),
  );
  assert(presentationVisible(), '11. new navigation can show CTA');
}

// --- 12. tab isolation ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.setActiveTab('tab_a');
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  const fpA = offerVerified();
  browserMediaActionService.markConsumed(fpA);

  browserMediaActionService.setActiveTab('tab_b');
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified(makeMedia({ id: 'md_tab_b' }));
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '12. tab B independent of tab A consumed',
  );

  browserMediaActionService.setActiveTab('tab_a');
  assert(
    browserMediaActionService.getState().status === 'consumed',
    '12. switch back to A → still consumed',
  );
}

// --- 13. old generation cannot consume new media ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.setActiveTab('tab_gen');
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified(
    makeMedia({
      id: 'md_x',
      url: 'https://cdn.example.com/x.mp4',
      finalUrl: 'https://cdn.example.com/x.mp4',
    }),
  );
  const claimX = browserMediaActionService.claimForHandoff();
  assert(claimX.outcome === 'CLAIMED', '13. claim X');

  // Navigate to Y while X handoff in flight
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/999');
  offerVerified(
    makeMedia({
      id: 'md_y',
      pageUrl: 'https://www.tiktok.com/@user/video/999',
      url: 'https://cdn.example.com/y.mp4',
      finalUrl: 'https://cdn.example.com/y.mp4',
    }),
  );
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '13. Y available while X handoff pending',
  );

  if (claimX.outcome === 'CLAIMED') {
    browserMediaActionService.commitConsumed(
      claimX.tabId,
      claimX.fingerprint,
      claimX.handoffGeneration,
      'dl_x',
    );
  }
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '13. stale X commit does not consume Y',
  );
  assert(presentationVisible(), '13. Y CTA still visible');
}

// --- 14–15. quality cancel / quality success ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified();
  const lock = browserMediaActionService.beginQualitySelection();
  assert(lock.outcome === 'LOCKED', '14. quality selection locked');
  assert(browserMediaActionService.getState().selectionLocked, '14. selectionLocked flag');
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '14. sheet open is not handoff/consume',
  );
  const dup = browserMediaActionService.beginQualitySelection();
  assert(dup.outcome === 'ALREADY_LOCKED', '14. duplicate sheet blocked');
  browserMediaActionService.endQualitySelection();
  assert(!browserMediaActionService.getState().selectionLocked, '14. cancel clears lock');
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'AVAILABLE',
    '14. quality cancel → AVAILABLE',
  );

  const lock2 = browserMediaActionService.beginQualitySelection();
  assert(lock2.outcome === 'LOCKED', '15. re-lock for success');
  if (lock2.outcome === 'LOCKED') {
    browserMediaActionService.commitConsumed(lock2.tabId, lock2.fingerprint, -1, 'dl_q');
  }
  assert(
    toBrowserMediaCtaState(browserMediaActionService.getState().status) === 'CONSUMED',
    '15. quality success → CONSUMED',
  );
}

// --- 16. rapid double tap → one handoff ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.resetForNavigation('https://www.tiktok.com/@user/video/123');
  offerVerified();
  const a = browserMediaActionService.claimForHandoff();
  const b = browserMediaActionService.claimForHandoff();
  const c = browserMediaActionService.claimForHandoff();
  assert(a.outcome === 'CLAIMED', '16. first tap claims');
  assert(b.outcome === 'ALREADY_IN_PROGRESS', '16. second tap blocked');
  assert(c.outcome === 'ALREADY_IN_PROGRESS', '16. triple tap blocked');
  assert(
    browserMediaActionService.__getPendingHandoffCountForTests() === 1,
    '16. one handoff only',
  );
}

// --- 17. tab close cleanup bounded ---
{
  browserMediaActionService.__resetAllForTests();
  browserMediaActionService.setActiveTab('tab_close');
  offerVerified();
  browserMediaActionService.claimForHandoff();
  browserMediaActionService.clearTab('tab_close');
  browserMediaActionService.setActiveTab('tab_other');
  assert(
    browserMediaActionService.getState().status === 'idle',
    '17. closed tab state not retained on new active tab',
  );
}

// --- 18–20. static: no completion dependency, no polling, canonical enqueue ---
{
  const hookSrc = read('src/browser/media-actions/useBrowserMediaAction.ts');
  const serviceSrc = read('src/browser/media-actions/browser-media-action.service.ts');
  const downloadSrc = read('src/browser/media-actions/browser-media-download.service.ts');
  const barSrc = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');

  assert(
    !hookSrc.includes('useDownloadsStore') && !hookSrc.includes('downloadItems'),
    '18. no Phase 1 download store subscription for CTA hide',
  );
  assert(
    serviceSrc.includes('Successful Phase 1 enqueue is the consume boundary') ||
      serviceSrc.includes('enqueue is the consume boundary') ||
      serviceSrc.includes('consume boundary'),
    '18. service documents enqueue boundary',
  );
  assert(
    !hookSrc.includes('setInterval') &&
      !hookSrc.includes('refetchInterval') &&
      !serviceSrc.includes('setInterval') &&
      !barSrc.includes('setInterval'),
    '19. no polling/refetch interval added',
  );
  assert(
    hookSrc.includes('enqueueBrowserMediaDownload') &&
      hookSrc.includes('claimForHandoff') &&
      downloadSrc.includes('useDownloadsStore.getState().create'),
    '20. Phase 1 handoff still uses canonical enqueue path',
  );
  assert(
    hookSrc.includes('commitConsumed') && hookSrc.includes('releaseHandoff'),
    '20. commit/release owned by service path',
  );
  assert(
    Object.keys(initialBrowserMediaActionState).includes('selectionLocked'),
    'selectionLocked present on state',
  );
}

// Signed URL refresh → same fingerprint
{
  const fp1 = buildBrowserMediaFingerprint({
    pageUrl: 'https://www.instagram.com/reel/ABC/',
    mediaUrl: 'https://cdn.example.com/v.mp4?sig=aaa&exp=1',
    platform: 'instagram',
  });
  const fp2 = buildBrowserMediaFingerprint({
    pageUrl: 'https://www.instagram.com/reel/ABC/',
    mediaUrl: 'https://cdn.example.com/v.mp4?sig=bbb&exp=2',
    platform: 'instagram',
  });
  assert(fp1 === fp2, 'signed URL refresh → same media fingerprint');
}

console.log(`\nBrowser CTA lifecycle: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
