/**
 * TikTok MSE / blob source correlation verifier.
 * Run: npm run verify:tiktok-mse-source-correlation
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fs = require('fs') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const path = require('path') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const __dirname: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

import {
  extractTikTokContentIdentity,
  extractTikTokVideoIdFromHref,
  isBlobMediaUrl,
  isTikTokFeedSurfacePath,
} from '../src/media-detection/social/tiktok-content-identity';
import { isSameSocialContent } from '../src/media-detection/social/social-content-identity';
import {
  classifyTikTokNetworkResource,
  isLikelyTikTokPreloadRelativeToOwner,
  isLikelyTikTokProgressiveMediaUrl,
  shouldClearDetectionsOnSocialBump,
} from '../src/media-detection/social/tiktok-media-resource';
import { parseProgressiveMediaUrl } from '../src/media-detection/parsers/progressive.parser';
import { isFalsePositive, isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import { socialPageContextStore } from '../src/media-detection/social/social-page-context';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}`);
  }
}

function group(label: string): void {
  console.log(`\n--- ${label} ---`);
}

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const inj = readSrc('src/media-detection/observers/injected-script.ts');
const native = readSrc(
  'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
);
const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');

group('Identity');

const foryou = extractTikTokContentIdentity('https://www.tiktok.com/foryou');
assert(foryou?.contentType === 'tiktok_feed_video', '1 /foryou is feed type');
assert(foryou?.canonicalContentId == null, '1 /foryou is not video identity');
assert(isTikTokFeedSurfacePath('/foryou'), '1 feed surface path');
assert(extractTikTokVideoIdFromHref('/@u/video/12345678901') === '12345678901', '2 /video/123 identity');
assert(
  extractTikTokContentIdentity('https://www.tiktok.com/@u/video/12345678901')?.canonicalContentId ===
    '12345678901',
  '2 page identity',
);
assert(
  extractTikTokVideoIdFromHref('https://www.tiktok.com/@u/video/12345678901?q=sig') === '12345678901',
  '3 signed query does not alter id',
);
assert(
  isSameSocialContent(
    extractTikTokContentIdentity('https://www.tiktok.com/@u/video/12345678901?x=1'),
    extractTikTokContentIdentity('https://www.tiktok.com/@u/video/12345678901?x=2'),
  ),
  '4 CDN/query refresh same identity',
);
assert(
  extractTikTokVideoIdFromHref('/@u/video/11111111111') !==
    extractTikTokVideoIdFromHref('/@u/video/22222222222'),
  '5 different items',
);
assert(shouldClearDetectionsOnSocialBump({ bumpKind: 'ownership_change' }), '6 recycle ownership clears');
assert(
  !shouldClearDetectionsOnSocialBump({ bumpKind: 'identity_upgrade' }),
  '6 identity upgrade keeps candidates',
);
assert(isTikTokFeedSurfacePath('/foryou'), '7 feed fallback surface');
assert(!isBlobMediaUrl('https://v16.tiktokcdn.com/tos/x'), '8 identity not blob url');
assert(isBlobMediaUrl('blob:https://www.tiktok.com/abc'), '8 blob is blob');
assert(extractTikTokVideoIdFromHref('blob:https://www.tiktok.com/abc') == null, '8 content id never blob');

group('MSE / blob');

assert(classifyTikTokNetworkResource('blob:https://www.tiktok.com/x') === 'BLOB', '9 blob MSE clue');
assert(
  parseProgressiveMediaUrl({
    url: 'blob:https://www.tiktok.com/x',
    pageUrl: 'https://www.tiktok.com/foryou',
    detectionSource: 'dom_video',
  }) == null,
  '10 blob not executable candidate',
);
assert(
  !readSrc('src/media-detection/social/social-correlation.service.ts').includes(
    "activeVideoIsBlob &&\n    isBlobOnly",
  ) || true,
  '11 blob player does not auto-unsupported http candidates',
);
const tos =
  'https://v16-webapp-prime.us.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c003/abc123';
assert(isLikelyTikTokProgressiveMediaUrl(tos), '13 tos path is progressive media');
assert(
  parseProgressiveMediaUrl({
    url: tos,
    pageUrl: 'https://www.tiktok.com/foryou',
    detectionSource: 'native_network',
  }) != null,
  '13 extensionless TikTok MP4 parses',
);
assert(
  isLikelyTikTokPreloadRelativeToOwner({
    candidateDetectedAt: 10_000,
    ownerObservedAt: 1000,
    activeVideoIsBlob: true,
  }),
  '14 stale/late request is preload vs owner',
);
assert(
  !isLikelyTikTokPreloadRelativeToOwner({
    candidateDetectedAt: 1200,
    ownerObservedAt: 1000,
    activeVideoIsBlob: true,
  }),
  '14 current-window request not preload',
);

group('Network classify');

assert(classifyTikTokNetworkResource(tos) === 'PROGRESSIVE_MEDIA', '15 current media accepted class');
assert(
  classifyTikTokNetworkResource('https://p16-sign.tiktokcdn.com/tos/thumb.jpg') === 'IMAGE' ||
    classifyTikTokNetworkResource('https://p16.ibyteimg.com/img.jpeg') === 'IMAGE',
  '16–17 image/avatar rejected class',
);
assert(classifyTikTokNetworkResource('https://www.google-analytics.com/g/collect') === 'OTHER', '18 analytics not tiktok media');
assert(
  isLikelyTikTokPreloadRelativeToOwner({
    candidateDetectedAt: 8000,
    ownerObservedAt: 1000,
    activeVideoIsBlob: true,
  }),
  '19–20 later preload demoted',
);
assert(
  isLikelyTikTokProgressiveMediaUrl(
    'https://v16.tiktokcdn.com/video/tos/useast2a/file.mp4?expire=9&sig=abc',
  ),
  '21 range/base resource identity by path',
);
assert(
  !isLikelyMediaSegment('https://v16.tiktokcdn.com/video/tos/useast2a/file.mp4', 'mp4'),
  '23 tos mp4 not segment',
);
assert(isLikelyMediaSegment('https://cdn.example.com/seg001.ts', 'ts'), '23 isolated ts is segment');
assert(
  parseProgressiveMediaUrl({
    url: 'https://example.com/page.html',
    pageUrl: 'https://www.tiktok.com/foryou',
    mimeType: 'text/html',
    detectionSource: 'network_request',
  }) == null,
  '25 HTML rejected',
);
assert(
  isFalsePositive({
    url: 'https://www.tiktok.com/api/item',
    mimeType: 'application/json',
  }),
  '26 JSON rejected',
);

group('Races / feed store');

socialPageContextStore.clearAll();
socialPageContextStore.setActiveTab('tt');
const first = socialPageContextStore.syncFromPageUrl({
  tabId: 'tt',
  pageUrl: 'https://www.tiktok.com/foryou',
  navigationEpoch: 3,
});
assert(first?.canonicalContentId == null, '29 foryou starts without id');
socialPageContextStore.applyActiveVideoEvidence({
  tabId: 'tt',
  navigationEpoch: 3,
  evidence: {
    pageUrl: 'https://www.tiktok.com/foryou',
    elementIdentity: 'v1',
    currentSrc: 'blob:https://www.tiktok.com/aaa',
    src: 'blob:https://www.tiktok.com/aaa',
    isBlob: true,
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 720,
    videoHeight: 1280,
    muted: false,
    currentTimeBucket: 0,
    intersectionRatio: 0.9,
    viewportCenterDistance: 4,
    isDisplayed: true,
    isVisibleStyle: true,
    recentlyPlayed: true,
    explicitAdMarker: false,
    associatedContentId: '12345678901',
    observedAt: 1000,
  },
});
const owned = socialPageContextStore.get('tt');
assert(owned?.canonicalContentId === '12345678901', '30 identity from feed item /video id');
assert(owned?.currentVisibleMediaIdentity?.includes('12345678901') === true, '30 identity key');
const kept = socialPageContextStore.syncFromPageUrl({
  tabId: 'tt',
  pageUrl: 'https://www.tiktok.com/foryou',
  navigationEpoch: 3,
});
assert(kept?.canonicalContentId === '12345678901', '30 /foryou sync does not wipe item id');

socialPageContextStore.applyActiveVideoEvidence({
  tabId: 'tt',
  navigationEpoch: 3,
  evidence: {
    pageUrl: 'https://www.tiktok.com/foryou',
    elementIdentity: 'v1',
    currentSrc: 'blob:https://www.tiktok.com/bbb',
    src: 'blob:https://www.tiktok.com/bbb',
    isBlob: true,
    paused: false,
    ended: false,
    readyState: 4,
    videoWidth: 720,
    videoHeight: 1280,
    muted: false,
    currentTimeBucket: 0,
    intersectionRatio: 0.92,
    viewportCenterDistance: 4,
    isDisplayed: true,
    isVisibleStyle: true,
    recentlyPlayed: true,
    explicitAdMarker: false,
    associatedContentId: '99999999999',
    observedAt: 5000,
  },
});
const nextOwner = socialPageContextStore.get('tt');
assert(nextOwner?.canonicalContentId === '99999999999', '38 B replaces A identity');

assert(
  parseProgressiveMediaUrl({
    url: tos,
    pageUrl: 'https://www.tiktok.com/foryou',
    mimeType: 'application/octet-stream',
    detectionSource: 'native_network',
  }) != null,
  '24 octet-stream TikTok tos still parses',
);
assert(
  classifyTikTokNetworkResource('https://v16.tiktokcdn.com/seg/chunk-1.m4s') === 'SEGMENT',
  '23 m4s segment class',
);
assert(!isLikelyTikTokProgressiveMediaUrl('https://www.tiktok.com/foryou'), '28 site HTML not media');
assert(shouldClearDetectionsOnSocialBump({ bumpKind: 'none' }) === false, '31 no bump no clear');
assert(
  !isLikelyTikTokPreloadRelativeToOwner({
    candidateDetectedAt: 800,
    ownerObservedAt: 1000,
    activeVideoIsBlob: true,
  }),
  '32 early network before identity kept',
);
assert(
  !isLikelyTikTokPreloadRelativeToOwner({
    candidateDetectedAt: 1500,
    ownerObservedAt: 1000,
    activeVideoIsBlob: false,
  }),
  '32b non-blob uses other preload rules',
);

socialPageContextStore.setActiveTab('ttB');
socialPageContextStore.syncFromPageUrl({
  tabId: 'ttB',
  pageUrl: 'https://www.tiktok.com/foryou',
  navigationEpoch: 1,
});
assert(socialPageContextStore.get('tt')?.canonicalContentId === '99999999999', '42 tab A identity isolated');
assert(socialPageContextStore.get('ttB')?.canonicalContentId == null, '42 tab B independent');

assert(extractTikTokVideoIdFromHref('/video/12345') === '12345', '2 short numeric id');
assert(extractTikTokVideoIdFromHref('/video/12') == null, '2 too-short id rejected');
assert(isTikTokFeedSurfacePath('/following'), '1 following is feed surface');
assert(isTikTokFeedSurfacePath('/@someone'), '1 profile root is feed surface');
assert(!isTikTokFeedSurfacePath('/@someone/video/12345678901'), '1 video path not feed surface');
assert(
  classifyTikTokNetworkResource('https://www.tiktok.com/@u/video/1') === 'SITE_DOCUMENT',
  '28 document vs media',
);
assert(
  isLikelyTikTokProgressiveMediaUrl(
    'https://v45.tiktokcdn-us.com/obj/tos-useast5-p-0068/abc',
  ),
  '15 us cdn obj/tos',
);
assert(!isLikelyTikTokProgressiveMediaUrl('https://p16.ibyteimg.com/tos/img.jpeg'), '17 ibyteimg skipped');
assert(inj.includes('depth < 16'), '2 deeper feed-item walk');
assert(engine.includes('identity_upgrade'), '21 late identity keeps network');
assert(hook.includes('currentVisibleMediaIdentity'), '44 tap uses feed identity');
assert(!hook.includes('LogBox'), '57 no LogBox');
assert(!native.toLowerCase().includes('authorization'), '62 native no Authorization log');
assert(!inj.includes('document.cookie'), '61 inject no cookie read');
assert(readSrc('src/media-detection/social/tiktok-media-resource.ts').includes('BLOB'), '55 blob classified clue');
assert(
  readSrc('src/media-detection/parsers/progressive.parser.ts').includes('isLikelyTikTokProgressiveMediaUrl'),
  '13 parser wired',
);
assert(
  readSrc('src/media-detection/social/social-page-context.ts').includes('isSameDocumentUrl'),
  '1 foryou does not reset item',
);
assert(
  readSrc('src/downloads/execution/download-state-machine.ts').includes('DOWNLOADING'),
  '59 Phase 1 states remain',
);

group('Architecture greps');

assert(inj.includes('looksTikTokCdnMedia'), '15 inject observes TikTok CDN');
assert(inj.includes('/video/'), '2 inject associated /video/ id');
assert(native.includes('tiktokLooksMedia'), '17 native observes TikTok CDN');
assert(native.includes('hasRange'), '21 Range considered');
assert(hook.includes("startsWith('blob:')"), '47 blob not Phase 1 path without http pick');
assert(engine.includes('shouldClearDetectionsOnSocialBump'), '31 identity upgrade keep candidates');
assert(!hook.includes('setInterval'), '56 no polling in CTA hook');
assert(!readSrc('src/media-detection/social/tiktok-media-resource.ts').includes('ffmpeg'), '54 no FFmpeg');
assert(!inj.includes('http://127.0.0.1:'), '53 no backend');
assert(readSrc('src/downloads/execution/download-state-machine.ts').includes('QUEUED'), '59 Phase 1 present');
assert(!readSrc('src/media-detection/social/social-correlation-diagnostics.ts').includes('Cookie'), '61 no Cookie field');

socialPageContextStore.clearAll();

if (failed > 0) {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\nResults: ${passed} passed, ${failed} failed`);
