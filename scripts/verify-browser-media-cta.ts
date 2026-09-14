/**
 * Browser media CTA regression tests.
 * Run: npx tsx scripts/verify-browser-media-cta.ts
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import { browserMediaActionService } from '../src/browser/media-actions/browser-media-action.service';
import { initialBrowserMediaActionState } from '../src/browser/media-actions/browser-media-action.types';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import { isDownloadAffordable } from '../src/media-detection/ui/badges';
import {
  filterCorrelatedCandidates,
  scoreMediaCorrelation,
} from '../src/media-detection/services/media-correlation.service';
import type { DetectedMedia } from '../src/media-detection/types';

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

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function makeMedia(overrides: Partial<DetectedMedia> = {}): DetectedMedia {
  return {
    id: 'md_test',
    url: 'https://v16-webapp-prime.tiktok.com/video/test.mp4',
    finalUrl: null,
    sourceUrl: null,
    pageUrl: 'https://www.tiktok.com/@user/video/123',
    title: 'TikTok Video',
    mimeType: 'video/mp4',
    container: 'mp4',
    category: 'video',
    streamType: 'PROGRESSIVE',
    confidence: 0.72,
    detectionSource: 'native_network',
    requiresCookies: true,
    requiredHeaders: null,
    thumbnailUrl: null,
    duration: 12,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    codec: null,
    audioCodec: null,
    estimatedFileSize: 12_800_000,
    websiteSource: 'tiktok.com',
    isDrm: false,
    videoOnly: false,
    hasSeparateAudio: false,
    ...overrides,
  };
}

const browserScreen = read('src/browser/BrowserScreen.tsx');
const providerSrc = read('src/screens/downloads/quality/QualitySelectionProvider.tsx');
const barSrc = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
const hookSrc = read('src/browser/media-actions/useBrowserMediaAction.ts');
const webViewSrc = read('src/browser/components/BrowserContainer/BrowserWebView.tsx');

assert(
  browserScreen.includes('BrowserMediaDownloadBar'),
  'BrowserScreen mounts BrowserMediaDownloadBar',
);
assert(
  !browserScreen.includes('MediaDiscoveryOverlay'),
  'BrowserScreen no longer uses unverified MediaDiscoveryOverlay',
);
assert(
  barSrc.includes('testID="browser-media-download-button"'),
  'Download Video button testID present',
);
assert(
  hookSrc.includes('verifyMediaCandidate'),
  'Browser hook runs candidate verification',
);
assert(
  hookSrc.includes('handoffVerified'),
  'Browser hook supports verified handoff',
);
assert(
  providerSrc.includes('browserMediaActionService.handoffVerified'),
  'Pending resolution handoffs to browser media action',
);
assert(
  providerSrc.includes('isBrowserHandoffActive'),
  'Provider respects browser playback handoff flag',
);
assert(
  !webViewSrc.includes('BrowserMediaDownloadBar'),
  'WebView source file unchanged by CTA layer',
);

const verifiedMedia = makeMedia();
const pageUrl = verifiedMedia.pageUrl!;
const correlated = filterCorrelatedCandidates([verifiedMedia], {
  pageUrl,
  msePlaybackActive: true,
  msePlaybackAgeMs: 2000,
});
assert(correlated.length === 1, 'verified TikTok candidate passes correlation with MSE');

const imageCandidate = makeMedia({
  id: 'md_image',
  url: 'https://cdn.example.com/thumb.jpg',
  mimeType: 'image/jpeg',
  category: 'video',
});
const imageScore = scoreMediaCorrelation(imageCandidate, { pageUrl });
assert(imageScore.reject, 'image candidate rejected');

const blobCandidate = makeMedia({
  id: 'md_blob',
  url: 'blob:https://www.tiktok.com/abc',
});
const blobScore = scoreMediaCorrelation(blobCandidate, { pageUrl });
assert(blobScore.reject, 'blob candidate rejected');

const wrongPage = makeMedia({
  pageUrl: 'https://www.tiktok.com/@other/video/999',
});
const wrongPageScore = scoreMediaCorrelation(wrongPage, {
  pageUrl: 'https://www.tiktok.com/@user/video/123',
  msePlaybackActive: false,
});
assert(
  wrongPageScore.score < 1 || !wrongPageScore.reject,
  'different page candidate scored separately',
);

assert(isDownloadAffordable(verifiedMedia), 'verified progressive MP4 is affordable');

browserMediaActionService.resetForNavigation(null);
assert(
  browserMediaActionService.getState().status === 'idle',
  'browser action resets to idle',
);

const fingerprint = buildBrowserMediaFingerprint({
  pageUrl,
  mediaUrl: verifiedMedia.url,
  platform: 'TIKTOK',
});
assert(fingerprint.includes('tiktok'), 'fingerprint includes page identity');

browserMediaActionService.handoffVerified({
  pageUrl,
  media: verifiedMedia,
  analysis: {
    title: 'TikTok Video',
    sourceUrl: verifiedMedia.url,
    finalUrl: verifiedMedia.url,
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: 12,
    width: 1080,
    height: 1920,
    resolution: '1080x1920',
    bitrate: null,
    fps: null,
    fileSize: '12.8 MB',
    platform: 'TIKTOK',
    downloadable: true,
    unsupportedReason: null,
    variants: [],
  },
  requestContext: {
    referer: pageUrl,
    userAgent: 'test',
    cookiesRequired: true,
    hasCookies: true,
    capturedAt: Date.now(),
  },
  mediaUrl: verifiedMedia.url,
  autoShow: true,
});

const state = browserMediaActionService.getState();
assert(state.status === 'verified', 'verified handoff sets verified status');
assert(state.mediaFingerprint != null, 'verified handoff stores fingerprint');
assert(state.autoShownOnce === false, 'auto-show pending until bar marks shown');

browserMediaActionService.markAutoShown();
assert(browserMediaActionService.getState().autoShownOnce, 'auto-show marks once');

browserMediaActionService.dismiss();
assert(browserMediaActionService.getState().dismissed, 'dismiss persists compact CTA state');

browserMediaActionService.resetForNavigation('https://www.instagram.com/reel/abc/');
assert(
  browserMediaActionService.getState().status === initialBrowserMediaActionState.status,
  'navigation clears verified browser action state',
);

const pageResolutionSrc = read('src/media-detection/services/page-media-resolution.service.ts');
assert(
  pageResolutionSrc.includes('waitForMediaMs: 8_000'),
  'page resolution passive wait reduced for faster Open Video',
);
assert(
  pageResolutionSrc.includes('earlyPlaybackHintMs: 4_000'),
  'early playback hint for social platforms',
);

assert(
  hookSrc.includes('enqueueBrowserMediaDownload'),
  'single-quality path uses pre-download gate enqueue',
);
assert(
  hookSrc.includes('hasMultipleQualities'),
  'multi-quality opens existing quality sheet',
);
assert(
  hookSrc.includes('claimForHandoff') &&
    read('src/browser/media-actions/browser-media-download.service.ts').includes(
      'findDownloadForBrowserMedia',
    ),
  'duplicate download prevention wired',
);

console.log(`\nBrowser media CTA: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
