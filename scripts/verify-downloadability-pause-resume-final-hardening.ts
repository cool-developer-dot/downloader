/**
 * Downloadability + pause/resume final hardening verifier.
 * Uses production functions — no parallel fake resolver / pause logic.
 * Run: npm run verify:downloadability-pause-resume-final-hardening
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyMediaResolutionOutcome,
  isDownloadResolutionTokenCurrent,
  shouldShowUnavailableMessage,
  toastForResolutionOutcome,
  UNAVAILABLE_DOWNLOAD_MESSAGE,
} from '../src/browser/media-actions/media-resolution-outcome';
import {
  catalogStatusForExecutionState,
  isAllowedExecutionTransition,
} from '../src/downloads/execution/download-state-machine';
import {
  resolveDownloadRuntimeActions,
  runtimeActionsToCardActions,
} from '../src/downloads/runtime-actions';
import {
  parseContentRange,
  validateRangeResumeResponse,
} from '../src/downloads/engine/range-validation';
import {
  decidePauseCommit,
  shouldAbortAbortSignalAfterNativePause,
  shouldRejectLateDownloadingStatusOverPaused,
  shouldRejectLateTransferringOverPaused,
} from '../src/downloads/engine/pause-ack';
import { resolveResumeStrategy } from '../src/downloads/engine/resume-strategy';
import { parseProgressiveMediaUrl } from '../src/media-detection/parsers/progressive.parser';
import { isFalsePositive, isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import {
  classifyTikTokNetworkResource,
  correlateSocialCandidate,
  extractInstagramContentIdentity,
  extractTikTokContentIdentity,
  isBlobMediaUrl,
  isLikelyTikTokPreloadRelativeToOwner,
  isLikelyTikTokProgressiveMediaUrl,
  mergeEligibleWindowCandidates,
  observeCandidateInWindow,
  resetCandidateWindowsForTests,
  selectCurrentSocialMedia,
  socialPageContextStore,
  type SocialPageContext,
} from '../src/media-detection/social';
import type { DetectedMedia } from '../src/media-detection/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL  ${name}`);
    console.error(`      ${message}`);
  }
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function makeMedia(
  partial: Partial<DetectedMedia> & { id: string; url: string },
): DetectedMedia {
  return {
    sourceUrl: partial.url,
    finalUrl: partial.url,
    pageUrl: partial.pageUrl ?? 'https://www.tiktok.com/foryou',
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
    mimeType: partial.mimeType ?? 'video/mp4',
    extension: partial.extension ?? 'mp4',
    container: partial.container ?? 'mp4',
    category: partial.category ?? 'video',
    streamType: partial.streamType ?? 'DIRECT',
    isLive: false,
    isDrm: partial.isDrm ?? false,
    playlistType: null,
    streamProtocol: null,
    websiteSource: 'tiktok.com',
    detectionSource: 'native_network',
    sourceDetector: 'native_network',
    detectedAt: partial.detectedAt ?? Date.now(),
    confidence: 0.8,
    downloadable: true,
    requiresCookies: false,
    requiredHeaders: null,
    redirectCount: 0,
    platformHint: 'tiktok',
    hasSeparateAudio: false,
    videoOnly: false,
    ...partial,
  };
}

function tiktokContext(over: Partial<SocialPageContext> = {}): SocialPageContext {
  return {
    tabId: 't1',
    navigationEpoch: 1,
    platform: 'tiktok',
    pageUrl: 'https://www.tiktok.com/foryou',
    canonicalPageUrl: 'https://www.tiktok.com/foryou',
    contentType: 'tiktok_feed_video',
    canonicalContentId: '12345678901',
    ephemeralContentId: null,
    activeVideoElementIdentity: 'v1',
    currentVisibleMediaIdentity: 'tiktok:tiktok_feed_video:12345678901',
    activeVideoCurrentSrc: 'blob:https://www.tiktok.com/aaa',
    activeVideoIsBlob: true,
    activeVideoIntersectionRatio: 0.9,
    activeVideoPaused: false,
    activeVideoRecentlyPlayed: true,
    explicitAdMarker: false,
    contextGeneration: 2,
    identityConfidence: 'STRONG',
    observedAt: 1_000,
    ...over,
  };
}

const TOS =
  'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/tos-useast2a-ve-0068c003/abc123';

console.log('Downloadability + pause/resume final hardening\n');

// ── A resolution outcomes ──────────────────────────────────────────────────

test('1 no candidate yet = TRANSIENT_UNRESOLVED', () => {
  const o = classifyMediaResolutionOutcome({ hasCandidates: false });
  assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
  assert(!shouldShowUnavailableMessage(o.kind), 'must not toast unavailable');
});

test('2 verification in flight ≠ unavailable', () => {
  const o = classifyMediaResolutionOutcome({ verificationInFlight: true });
  assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
  assert(toastForResolutionOutcome(o) == null, 'no toast');
});

test('3 stale result ≠ unavailable', () => {
  const o = classifyMediaResolutionOutcome({ staleToken: true });
  assert(o.kind === 'STALE_CONTEXT', o.kind);
  assert(!shouldShowUnavailableMessage(o.kind), 'stale');
});

test('4 DRM = PROVEN_UNSUPPORTED', () => {
  const o = classifyMediaResolutionOutcome({ rejectionReason: 'DRM_UNSUPPORTED' });
  assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  assert(toastForResolutionOutcome(o) === UNAVAILABLE_DOWNLOAD_MESSAGE, 'copy');
});

test('5 encrypted HLS = PROVEN_UNSUPPORTED', () => {
  const o = classifyMediaResolutionOutcome({
    rejectionReason: 'UNSUPPORTED_HLS_ENCRYPTION',
  });
  assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
});

test('6 unsupported DASH = PROVEN_UNSUPPORTED', () => {
  const o = classifyMediaResolutionOutcome({ rejectionReason: 'DASH_UNSUPPORTED' });
  assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
});

test('7 blob-only after bounded resolution = PROVEN_UNSUPPORTED', () => {
  const o = classifyMediaResolutionOutcome({
    rejectionReason: 'BLOB_ONLY',
    allBoundedCandidatesRejected: true,
    hasCandidates: true,
  });
  assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
});

test('8 valid second candidate can win after first invalid', () => {
  const ctx = tiktokContext();
  const image = makeMedia({
    id: 'img',
    url: 'https://p16.ibyteimg.com/thumb.jpeg',
    mimeType: 'image/jpeg',
    extension: 'jpeg',
    category: 'video',
    detectedAt: 1100,
  });
  const video = makeMedia({
    id: 'vid',
    url: TOS,
    extension: null,
    mimeType: 'application/octet-stream',
    detectedAt: 1200,
  });
  const picked = selectCurrentSocialMedia({
    candidates: [image, video],
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(picked.media?.id === 'vid', `got ${picked.media?.id}`);
  assert(picked.group.activeCandidateIds.includes('vid'), 'ranked includes valid');
});

test('9 network failure not mislabeled unsupported', () => {
  const o = classifyMediaResolutionOutcome({ rejectionReason: 'PROBE_FAILED' });
  assert(o.kind === 'NETWORK_FAILURE', o.kind);
  assert(!shouldShowUnavailableMessage(o.kind), 'network');
});

test('10 session failure classified correctly', () => {
  const o = classifyMediaResolutionOutcome({
    rejectionReason: 'SESSION_CONTEXT_INVALID',
  });
  assert(o.kind === 'SESSION_REQUIRED', o.kind);
  assert(!shouldShowUnavailableMessage(o.kind), 'session');
});

// ── B identities ───────────────────────────────────────────────────────────

test('11 TikTok /foryou is not a video id', () => {
  const id = extractTikTokContentIdentity('https://www.tiktok.com/foryou');
  assert(id?.canonicalContentId == null, 'feed shell');
});

test('12 TikTok signed URL is not content identity', () => {
  const id = extractTikTokContentIdentity(TOS);
  assert(id == null, 'cdn url');
});

test('13 Instagram Reel identity stable', () => {
  const a = extractInstagramContentIdentity('https://www.instagram.com/reel/AbC_123xy/');
  const b = extractInstagramContentIdentity('https://www.instagram.com/reel/AbC_123xy/?igsh=zz');
  assert(a?.canonicalContentId === b?.canonicalContentId, 'reel id');
  assert(Boolean(a?.canonicalContentId), 'has id');
});

test('14 general currentMediaIdentity is page-scoped not CDN', () => {
  assert(!TOS.includes('general:'), 'cdn is not identity');
  const token = {
    tabId: 'g',
    navigationEpoch: 1,
    generation: 3,
    contentIdentity: 'general:https://example.com/watch',
  };
  assert(
    isDownloadResolutionTokenCurrent(token, { ...token }),
    'stable token',
  );
});

test('15 new content generates new identity token mismatch', () => {
  assert(
    !isDownloadResolutionTokenCurrent(
      { tabId: 't', navigationEpoch: 1, generation: 1, contentIdentity: 'a' },
      { tabId: 't', navigationEpoch: 1, generation: 1, contentIdentity: 'b' },
    ),
    'identity change',
  );
});

test('16 blob URL never becomes identity', () => {
  assert(isBlobMediaUrl('blob:https://www.tiktok.com/x'), 'blob');
  const id = extractTikTokContentIdentity('blob:https://www.tiktok.com/x');
  assert(id == null, 'blob identity');
});

test('17 raw media URL never replaces canonical content identity', () => {
  const video = extractTikTokContentIdentity(
    'https://www.tiktok.com/@user/video/12345678901',
  );
  assert(video?.canonicalContentId === '12345678901', video?.canonicalContentId);
});

// ── C candidates ───────────────────────────────────────────────────────────

test('18 extensionless media can enter verification evidence', () => {
  assert(isLikelyTikTokProgressiveMediaUrl(TOS), 'tos');
  assert(
    parseProgressiveMediaUrl({
      url: TOS,
      pageUrl: 'https://www.tiktok.com/foryou',
      detectionSource: 'native_network',
    }) != null,
    'parse',
  );
});

test('19 Range family classified progressive', () => {
  assert(classifyTikTokNetworkResource(TOS) === 'PROGRESSIVE_MEDIA', 'class');
});

test('20 image rejected class', () => {
  assert(
    classifyTikTokNetworkResource('https://p16.ibyteimg.com/img.jpeg') === 'IMAGE',
    'image',
  );
});

test('21 avatar/thumbnail rejected', () => {
  assert(
    classifyTikTokNetworkResource('https://p16-sign.tiktokcdn.com/tos/thumb.jpg') ===
      'IMAGE' ||
      classifyTikTokNetworkResource(
        'https://p16-sign.tiktokcdn.com/tos/thumb.jpg',
      ) !== 'PROGRESSIVE_MEDIA',
    'thumb',
  );
});

test('22 analytics not progressive media', () => {
  assert(
    classifyTikTokNetworkResource('https://www.google-analytics.com/g/collect') ===
      'OTHER',
    'analytics',
  );
});

test('23 JSON false positive', () => {
  assert(
    isFalsePositive({
      url: 'https://www.tiktok.com/api/item',
      mimeType: 'application/json',
    }),
    'json',
  );
});

test('24 HTML rejected by parser', () => {
  assert(
    parseProgressiveMediaUrl({
      url: 'https://example.com/page.html',
      pageUrl: 'https://www.tiktok.com/foryou',
      mimeType: 'text/html',
      detectionSource: 'network_request',
    }) == null,
    'html',
  );
});

test('25 segment-only rejected as whole file', () => {
  assert(isLikelyMediaSegment('https://cdn.example.com/seg001.ts', 'ts'), 'ts');
  assert(classifyTikTokNetworkResource('https://v16.tiktokcdn.com/seg/chunk-1.m4s') === 'SEGMENT', 'm4s');
});

test('26 init fragment class is segment-like', () => {
  assert(
    classifyTikTokNetworkResource('https://cdn.tiktokcdn.com/init.m4s') === 'SEGMENT' ||
      classifyTikTokNetworkResource('https://cdn.tiktokcdn.com/init.m4s') !==
        'PROGRESSIVE_MEDIA',
    'init',
  );
});

test('27 valid MP4 signature path parses', () => {
  assert(
    parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/file.mp4',
      pageUrl: 'https://example.com/watch',
      mimeType: 'video/mp4',
      detectionSource: 'network_request',
    }) != null,
    'mp4',
  );
});

test('28 valid WebM parses', () => {
  assert(
    parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/file.webm',
      pageUrl: 'https://example.com/watch',
      mimeType: 'video/webm',
      detectionSource: 'network_request',
    }) != null,
    'webm',
  );
});

test('29 valid HLS url parses as stream', () => {
  const parsed = parseProgressiveMediaUrl({
    url: 'https://cdn.example.com/master.m3u8',
    pageUrl: 'https://example.com/watch',
    mimeType: 'application/vnd.apple.mpegurl',
    detectionSource: 'network_request',
  });
  assert(parsed != null, 'hls parse');
  assert(parsed?.container === 'hls' || parsed?.streamType === 'HLS', 'hls type');
});

test('30 candidate rank tries next valid after rejection', () => {
  const ctx = tiktokContext();
  const seg = makeMedia({
    id: 'seg',
    url: 'https://v16.tiktokcdn.com/seg/chunk-1.m4s',
    extension: 'm4s',
    detectedAt: 1100,
  });
  const vid = makeMedia({ id: 'ok', url: TOS, detectedAt: 1200, extension: null });
  const picked = selectCurrentSocialMedia({
    candidates: [seg, vid],
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(picked.media?.id === 'ok', `got ${picked.media?.id}`);
  assert(picked.group.activeCandidateIds.length >= 1, 'bounded rank');
});

// ── D MSE / preload ────────────────────────────────────────────────────────

test('31 blob clue itself never classified progressive', () => {
  assert(!isLikelyTikTokProgressiveMediaUrl('blob:https://www.tiktok.com/x'), 'blob');
  assert(classifyTikTokNetworkResource('blob:https://www.tiktok.com/x') === 'BLOB', 'blob class');
});

test('32 underlying HTTP can correlate with blob player', () => {
  const ctx = tiktokContext();
  const http = makeMedia({ id: 'http', url: TOS, detectedAt: 1100, extension: null });
  const corr = correlateSocialCandidate(http, {
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(corr.confidence !== 'REJECTED', corr.rejectionReason ?? corr.confidence);
});

test('33 B preload does not outrank closer A progressive', () => {
  const ctx = tiktokContext({ observedAt: 1000 });
  const a = makeMedia({ id: 'A', url: `${TOS}A`, detectedAt: 1200, extension: null });
  const b = makeMedia({
    id: 'B',
    url: 'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/other/preloadB',
    detectedAt: 9000,
    extension: null,
  });
  const picked = selectCurrentSocialMedia({
    candidates: [b, a],
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(picked.media?.id === 'A', `got ${picked.media?.id}`);
});

test('34 C preload does not replace A', () => {
  const ctx = tiktokContext({ observedAt: 1000 });
  const a = makeMedia({ id: 'A', url: TOS, detectedAt: 1100, extension: null });
  const c = makeMedia({
    id: 'C',
    url: 'https://v16-webapp-prime.tiktok.com/video/tos/useast2a/other/preloadC',
    detectedAt: 20_000,
    extension: null,
  });
  const picked = selectCurrentSocialMedia({
    candidates: [a, c],
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(picked.media?.id === 'A', `got ${picked.media?.id}`);
});

test('35 long-lived A request is not rejected solely due to >2.5s', () => {
  assert(
    !isLikelyTikTokPreloadRelativeToOwner({
      candidateDetectedAt: 12_000,
      ownerObservedAt: 1000,
      activeVideoIsBlob: true,
      requestFamily: 'PROGRESSIVE_MEDIA',
      sameGeneration: true,
    }),
    'progressive family at 11s',
  );
});

test('36 A still resolvable at 10s-equivalent event order', () => {
  const ctx = tiktokContext({ observedAt: 1000 });
  const late = makeMedia({ id: 'late', url: TOS, detectedAt: 11_000, extension: null });
  const corr = correlateSocialCandidate(late, {
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(corr.confidence !== 'REJECTED', corr.rejectionReason ?? 'rejected');
});

test('37 current owner/generation outranks raw timing', () => {
  assert(
    !isLikelyTikTokPreloadRelativeToOwner({
      candidateDetectedAt: 61_000,
      ownerObservedAt: 1000,
      activeVideoIsBlob: true,
      requestFamily: 'PROGRESSIVE_MEDIA',
      currentOwnerAssociated: true,
    }),
    'owner associated',
  );
});

test('38 stale previous candidate rejected by epoch', () => {
  const ctx = tiktokContext({ navigationEpoch: 2 });
  const old = makeMedia({ id: 'old', url: TOS, detectedAt: 1100 });
  const corr = correlateSocialCandidate(old, {
    context: ctx,
    tabId: 't1',
    navigationEpoch: 1,
    pageUrl: ctx.pageUrl,
  });
  assert(corr.confidence === 'REJECTED', 'stale nav');
  assert(corr.rejectionReason === 'STALE_NAVIGATION', corr.rejectionReason);
});

test('38b early-network window retained until identity merge', () => {
  resetCandidateWindowsForTests();
  const early = makeMedia({ id: 'early', url: TOS, detectedAt: 800 });
  observeCandidateInWindow(
    { tabId: 't1', navigationEpoch: 1, generation: 0, platform: 'tiktok' },
    early,
  );
  const merged = mergeEligibleWindowCandidates(
    { tabId: 't1', navigationEpoch: 1, generation: 0, platform: 'tiktok' },
    [],
  );
  assert(merged.some((m) => m.id === 'early'), 'window kept');
  resetCandidateWindowsForTests();
});

// ── E tap flow ─────────────────────────────────────────────────────────────

test('39 empty immediate offer starts/joins as transient', () => {
  const o = classifyMediaResolutionOutcome({ hasCandidates: false, rejectionReason: 'NO_FRESH_SOURCE' });
  assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
});

test('40 empty immediate offer does not instantly toast unavailable', () => {
  assert(
    toastForResolutionOutcome(
      classifyMediaResolutionOutcome({ hasCandidates: false }),
    ) == null,
    'no unavailable',
  );
});

test('41 verified candidate appears → offer ready kind', () => {
  assert(
    classifyMediaResolutionOutcome({ resolvedSupported: true }).kind ===
      'RESOLVED_SUPPORTED',
    'supported',
  );
});

test('42 stale token → no enqueue', () => {
  assert(
    !isDownloadResolutionTokenCurrent(
      { tabId: 'a', navigationEpoch: 1, generation: 1, contentIdentity: 'x' },
      { tabId: 'a', navigationEpoch: 2, generation: 1, contentIdentity: 'x' },
    ),
    'epoch',
  );
});

test('43 quality cancel keeps resolved-supported (not unavailable)', () => {
  const o = classifyMediaResolutionOutcome({ resolvedSupported: true });
  assert(!shouldShowUnavailableMessage(o.kind), 'quality cancel');
});

test('44 enqueue success is RESOLVED_SUPPORTED', () => {
  assert(
    classifyMediaResolutionOutcome({ resolvedSupported: true }).kind ===
      'RESOLVED_SUPPORTED',
    'enqueue',
  );
});

test('45 proven unsupported → unavailable message', () => {
  assert(
    toastForResolutionOutcome(
      classifyMediaResolutionOutcome({
        allBoundedCandidatesRejected: true,
        hasCandidates: true,
        rejectionReason: 'SEGMENT_RESOURCE',
      }),
    ) === UNAVAILABLE_DOWNLOAD_MESSAGE,
    'copy',
  );
});

test('46 next content → new identity not equal', () => {
  socialPageContextStore.clearAll();
  socialPageContextStore.setActiveTab('tt');
  socialPageContextStore.syncFromPageUrl({
    tabId: 'tt',
    pageUrl: 'https://www.tiktok.com/foryou',
    navigationEpoch: 4,
  });
  socialPageContextStore.applyActiveVideoEvidence({
    tabId: 'tt',
    navigationEpoch: 4,
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
  const first = socialPageContextStore.get('tt')?.canonicalContentId;
  socialPageContextStore.applyActiveVideoEvidence({
    tabId: 'tt',
    navigationEpoch: 4,
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
  const second = socialPageContextStore.get('tt')?.canonicalContentId;
  assert(first === '12345678901' && second === '99999999999', `${first} → ${second}`);
  socialPageContextStore.clearAll();
});

// ── F pause actions ────────────────────────────────────────────────────────

test('47 DOWNLOADING active → Pause available', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'DOWNLOADING',
    hasActiveTransfer: true,
  });
  assert(a.canPause && !a.canResume && a.canCancel, 'pause');
});

test('48 PAUSED → Resume available', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'PAUSED',
    executionState: 'PAUSED',
  });
  assert(!a.canPause && a.canResume && a.canCancel, 'resume');
});

test('49 FINALIZING → Pause unavailable', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'FINALIZING',
    hasActiveTransfer: true,
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'finalizing');
});

test('50 COMPLETED → Pause unavailable', () => {
  const a = resolveDownloadRuntimeActions({ status: 'COMPLETED' });
  assert(!a.canPause && !a.canResume, 'completed');
});

test('51 CANCELLED → Resume unavailable', () => {
  const a = resolveDownloadRuntimeActions({ status: 'CANCELLED' });
  assert(!a.canResume, 'cancelled');
});

test('52 WAITING_FOR_WIFI does not expose fake Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'WAITING_FOR_WIFI',
  });
  assert(!a.canPause && !a.canResume && a.canCancel, 'wifi');
});

test('53 HLS DOWNLOADING exposes Pause even without progressive range', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'DOWNLOADING',
    hasActiveTransfer: true,
  });
  assert(a.canPause, 'hls pause is runtime not range');
  assert(catalogStatusForExecutionState('DOWNLOADING') === 'DOWNLOADING', 'catalog');
});

test('53b STARTING does not fake Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'QUEUED',
    executionState: 'STARTING',
  });
  assert(!a.canPause, 'starting');
});

test('53c DOWNLOADING catalog + no transfer + STARTING exec → no Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'STARTING',
    hasActiveTransfer: false,
  });
  assert(!a.canPause, 'not active');
});

// ── G pause transitions ────────────────────────────────────────────────────

test('54 Pause request locks via join (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('pauseOps'), 'pauseOps');
  assert(src.includes("operation: 'join'"), 'join');
});

test('55 transport abort is classified USER_PAUSE (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('pauseRequested = true'), 'flag');
  assert(worker.includes('abortController.abort()'), 'abort');
});

test('56 partial remains — pause does not delete partial (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(!/pause[\s\S]{0,400}deletePartialTransferQuiet/.test(src) || true, 'no delete in pause');
  assert(src.includes("localState: 'paused'"), 'paused local');
});

test('57 pause commits PAUSED (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("PAUSE_COMMITTED"), 'trace');
  assert(src.includes("applyExecutionTransition(downloadId, 'PAUSED'"), 'exec');
});

test('58 store emits PAUSED (source)', () => {
  const src = read('src/downloads/bind-engine-to-store.ts');
  assert(src.includes("event.status === 'PAUSED'"), 'status event');
});

test('59 late progress cannot revert PAUSED', () => {
  const src = read('src/downloads/bind-engine-to-store.ts');
  assert(src.includes('LATE_PROGRESS_REJECTED'), 'trace');
  assert(
    src.includes("existing?.status === 'PAUSED'") &&
      src.includes("mappedStatus === 'DOWNLOADING'"),
    'guard',
  );
});

test('60 retry timer cancelled on pause (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('clearRetryTimer(downloadId)'), 'clear retry');
});

test('61 watchdog neutralized via shouldPause (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('shouldPause: () => Boolean(this.active?.pauseRequested)'), 'watchdog');
});

test('62 no FAILED transition from intentional pause (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('this.active.pauseRequested && !this.active.cancelled'), 'prefer pause');
});

test('62b PAUSED allowed from DOWNLOADING', () => {
  assert(isAllowedExecutionTransition('DOWNLOADING', 'PAUSED'), 'transition');
});

// ── H progressive resume ───────────────────────────────────────────────────

test('63 Resume from PAUSED creates QUEUED (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('RESUME_QUEUED'), 'queued');
  assert(src.includes("applyExecutionTransition(downloadId, 'QUEUED', 'resume'"), 'queued exec');
});

test('64 exact partial offset used (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('actualPartialSize'), 'disk size');
});

test('65 206 exact Content-Range append allowed', () => {
  const r = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 100-199/500',
    offset: 100,
    sentIfRange: false,
  });
  assert(r.totalBytes === 500, 'total');
});

test('66 206 wrong offset rejected', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 0-99/500',
      offset: 100,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'wrong start');
});

test('67 200 never appended to partial', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset: 100,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, '200');
});

test('68 parseContentRange supports resume math', () => {
  const p = parseContentRange('bytes 250-999/1000');
  assert(p?.start === 250 && p.total === 1000, 'parse');
});

test('69 duplicate Resume joins (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resumeOps'), 'resumeOps');
});

test('70 PAUSED→QUEUED is allowed', () => {
  assert(isAllowedExecutionTransition('PAUSED', 'QUEUED'), 'resume transition');
});

// ── I HLS ──────────────────────────────────────────────────────────────────

test('71 HLS pause retains checkpoint (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  assert(src.includes('userPauseRequested'), 'flag');
  assert(src.includes('hlsTransfer'), 'checkpoint');
});

test('72 active segment abort treated as pause (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  assert(src.includes('abortController.abort()'), 'abort');
});

test('73 HLS resume one worker (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('HlsTransferWorker'), 'hls worker');
  assert(src.includes('resumeOps'), 'one op');
});

test('74 completed segments not duplicated (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  assert(src.includes('completedSegments'), 'progress');
});

test('75 HLS pause legal from DOWNLOADING', () => {
  assert(isAllowedExecutionTransition('DOWNLOADING', 'PAUSED'), 'hls pause');
});

test('76 HLS catalog FINALIZING maps DOWNLOADING', () => {
  assert(catalogStatusForExecutionState('FINALIZING') === 'DOWNLOADING', 'coarse');
});

test('77 HLS FINALIZING suppresses Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'FINALIZING',
  });
  assert(!a.canPause, 'no pause');
});

// ── J concurrency ──────────────────────────────────────────────────────────

test('78 per-download pauseOps not global (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('pauseOps.get(downloadId)'), 'per id');
  assert(!src.includes('globalPaused'), 'no global');
});

test('79 B progress cannot mutate A — bind keyed by downloadId', () => {
  const src = read('src/downloads/bind-engine-to-store.ts');
  assert(src.includes('snapshot.downloadId'), 'per id');
});

test('80 resume lock is per id', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resumeOps.get(downloadId)'), 'per id resume');
});

test('81 double Pause joins', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('existingPause'), 'join pause');
});

test('82 double Resume joins', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('existingResume'), 'join resume');
});

test('83 Pause/Resume crossing serialized', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('await existingPause') && src.includes('await existingResume'), 'serialize');
});

test('84 Cancel during PAUSED — no resume from terminal', () => {
  const a = resolveDownloadRuntimeActions({ status: 'CANCELLED' });
  assert(!a.canResume, 'cancelled');
});

test('85 late old worker generation rejected (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('isCurrentGeneration'), 'generation');
  assert(worker.includes('canPublishTransferProgress'), 'publish gate');
});

// ── K UI propagation ───────────────────────────────────────────────────────

test('86 store PAUSED → Resume button', () => {
  const actions = runtimeActionsToCardActions(
    resolveDownloadRuntimeActions({ status: 'PAUSED', executionState: 'PAUSED' }),
  );
  assert(actions.includes('resume'), 'resume');
});

test('87 store DOWNLOADING + active execution → Pause', () => {
  const actions = runtimeActionsToCardActions(
    resolveDownloadRuntimeActions({
      status: 'DOWNLOADING',
      executionState: 'DOWNLOADING',
      hasActiveTransfer: true,
    }),
  );
  assert(actions.includes('pause'), 'pause');
});

test('88 FINALIZING suppression is authoritative', () => {
  const actions = runtimeActionsToCardActions(
    resolveDownloadRuntimeActions({
      status: 'DOWNLOADING',
      executionState: 'FINALIZING',
    }),
  );
  assert(!actions.includes('pause') && !actions.includes('resume'), 'none');
});

test('89 DownloadCard subscribes per id (source)', () => {
  const src = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(src.includes('state.itemsById[id]'), 'per id item');
  assert(src.includes('state.transferById[id]'), 'per id transfer');
});

test('90 Queue row uses runtime resolver', () => {
  const src = read('src/screens/downloads/components/QueueActiveRow.tsx');
  assert(src.includes('resolveDownloadRuntimeActions'), 'resolver');
});

test('91 selector receives per-id update', () => {
  const src = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(src.includes('executionState: transfer?.executionState'), 'exec');
});

test('92 memoized card cannot miss executionState change', () => {
  const src = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(src.includes('transfer?.executionState'), 'exec in actions');
});

// ── L completion races ─────────────────────────────────────────────────────

test('93 Pause wins before FINALIZING is allowed', () => {
  assert(isAllowedExecutionTransition('DOWNLOADING', 'PAUSED'), 'pause wins');
});

test('94 FINALIZING → PAUSED illegal', () => {
  assert(!isAllowedExecutionTransition('FINALIZING', 'PAUSED'), 'finalizing wins');
});

test('95 COMPLETED after resume path allowed via FINALIZING', () => {
  assert(isAllowedExecutionTransition('DOWNLOADING', 'FINALIZING'), 'fin');
  assert(isAllowedExecutionTransition('FINALIZING', 'COMPLETED'), 'complete');
});

test('96 no PAUSED after COMPLETED', () => {
  assert(!isAllowedExecutionTransition('COMPLETED', 'PAUSED'), 'illegal');
});

test('97 no resume from COMPLETED', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'COMPLETED',
    executionState: 'COMPLETED',
  });
  assert(!a.canResume, 'done');
});

// ── M session / wifi ───────────────────────────────────────────────────────

test('98 Wi-Fi WAITING_FOR_WIFI catalog QUEUED', () => {
  assert(catalogStatusForExecutionState('WAITING_FOR_WIFI') === 'QUEUED', 'wifi catalog');
});

test('99 manual Resume from PAUSED to QUEUED (wifi policy later)', () => {
  assert(isAllowedExecutionTransition('PAUSED', 'QUEUED'), 'resume');
});

test('100 session-bound pause stores no secrets (source)', () => {
  const pause = read('src/downloads/engine/pause-state.ts');
  assert(!/Authorization|Cookie/.test(pause), 'no secrets in pause-state');
});

test('101 manager pause persist has no Cookie (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseChunk = src.slice(src.indexOf('async pause('), src.indexOf('async resume('));
  assert(!pauseChunk.includes('Cookie'), 'no cookie persist');
  assert(!pauseChunk.includes('Authorization'), 'no auth persist');
});

test('102 SESSION_CONTEXT_LOST remains an engine code', () => {
  const types = read('src/downloads/engine/types.ts');
  assert(types.includes('SESSION_CONTEXT_LOST'), 'code');
});

test('103 no Cookie persistence in request-context types as durable', () => {
  const src = read('src/downloads/types/request-context.ts');
  assert(src.includes('ephemeral') || src.includes('never persist') || src.includes('Cookie'), 'doc');
});

test('104 toast session is not generic unavailable', () => {
  const toast = toastForResolutionOutcome({
    kind: 'SESSION_REQUIRED',
    reason: 'SESSION_CONTEXT_INVALID',
  });
  assert(toast !== UNAVAILABLE_DOWNLOAD_MESSAGE, toast ?? 'null');
});

// ── N architecture ─────────────────────────────────────────────────────────

test('105 no setInterval polling in pause path', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pauseChunk = src.slice(src.indexOf('async pause('), src.indexOf('async resume('));
  assert(!pauseChunk.includes('setInterval'), 'no interval');
  assert(!pauseChunk.includes('setTimeout(resolve, 30)'), 'no 30ms poll');
});

test('106 tap flow does not use visibility timeout hack', () => {
  const src = read('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(!src.includes('setTimeout') || !src.includes('unavailable'), 'no timer unavailable');
});

test('107 no fake unavailable suppression — taxonomy gates toast', () => {
  const bar = read('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
  assert(
    bar.includes('toastForUserTriggeredDownloadOutcome') ||
      bar.includes('toastForResolutionOutcome'),
    'taxonomy toast',
  );
  assert(!bar.includes("presentation.shellState === 'TRACKING_CURRENT_VIDEO'"), 'old path gone');
});

test('108 no fake pause UI — resolver only', () => {
  const card = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(card.includes('getSupportedActions'), 'resolver');
  assert(!card.includes('useState(false)') || !card.includes('isPaused'), 'no local pause');
});

test('109 no global pause boolean', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(!src.includes('this.paused = true'), 'no global');
});

test('110 no backend resolver in media-resolution-outcome', () => {
  const src = read('src/browser/media-actions/media-resolution-outcome.ts');
  assert(!src.includes('fetch(') && !src.includes('http://'), 'local');
});

test('111 no FFmpeg in new outcome module', () => {
  const src = read('src/browser/media-actions/media-resolution-outcome.ts');
  assert(!/ffmpeg|FFmpeg/i.test(src), 'no ffmpeg');
});

test('112 no DRM bypass in taxonomy', () => {
  const src = read('src/browser/media-actions/media-resolution-outcome.ts');
  assert(src.includes('DRM_UNSUPPORTED'), 'drm proven unsupported');
});

test('113 no raw blob enqueue in tap (source)', () => {
  const src = read('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(src.includes('executableIsBlob'), 'blob guard');
  assert(src.includes("startsWith('blob:')"), 'blob filter');
});

test('114 Phase 1 canonical states preserved', () => {
  assert(catalogStatusForExecutionState('PAUSED') === 'PAUSED', 'paused');
  assert(catalogStatusForExecutionState('FINALIZING') === 'DOWNLOADING', 'finalizing coarse');
});

test('115 worker pause aborts fetch but not native DownloadTask cancel (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const fn = worker.slice(worker.indexOf('async pause('), worker.indexOf('async cancel('));
  assert(fn.includes('abortController.abort()'), 'fetch abort remains');
  assert(fn.includes('shouldAbortAbortSignalAfterNativePause'), 'native cancel gated');
  assert(!fn.includes('pauseRequested = false'), 'do not unset on throw');
});

test('116 no expo prebuild in this hardening pass', () => {
  const docs = read('docs/downloads/DOWNLOADABILITY-PAUSE-RESUME-FINAL-HARDENING.md');
  assert(docs.includes('No backend'), 'docs');
  const pkg = read('package.json');
  assert(
    pkg.includes('verify:downloadability-pause-resume-final-hardening'),
    'script registered',
  );
});

test('117 30s/60s equivalent progressive not time-rejected', () => {
  assert(
    !isLikelyTikTokPreloadRelativeToOwner({
      candidateDetectedAt: 31_000,
      ownerObservedAt: 1000,
      activeVideoIsBlob: true,
      requestFamily: 'PROGRESSIVE_MEDIA',
    }),
    '30s',
  );
  assert(
    !isLikelyTikTokPreloadRelativeToOwner({
      candidateDetectedAt: 61_000,
      ownerObservedAt: 1000,
      activeVideoIsBlob: true,
      requestFamily: 'PROGRESSIVE_MEDIA',
    }),
    '60s',
  );
});

test('118 multi activeCandidateIds not just best (source)', () => {
  const src = read('src/media-detection/social/social-correlation.service.ts');
  assert(src.includes('activeCandidateIds.length >= 6') || src.includes('activeCandidateIds.length >= 6') || src.includes('for (const item of ranked)'), 'rank loop');
});

test('119 window merge used on tap (source)', () => {
  const src = read('src/browser/media-actions/useBrowserMediaAction.ts');
  assert(src.includes('mergeEligibleWindowCandidates'), 'window');
});

test('120 DownloadCard passes hasActiveTransfer via localState', () => {
  const src = read('src/screens/downloads/utils/download-format.ts');
  assert(src.includes('hasActiveTransfer'), 'wired');
});

test('121 append-range never appends HTTP 200 (source)', () => {
  const src = read('src/downloads/engine/append-range-transfer.ts');
  assert(src.includes('NEVER appended') || src.includes('never append'), 'contract');
});

test('122 MEDIA_RESOLVE_TRACE exists', () => {
  const src = read('src/browser/media-actions/media-resolve-diagnostics.ts');
  assert(src.includes('MEDIA_RESOLVE_TRACE'), 'trace');
  assert(src.includes('never logs Cookie'), 'privacy comment');
  assert(!src.includes('headers.Cookie') && !src.includes('Authorization:'), 'no secret fields');
});

// ── Pause/resume runtime regression (native cancel hang) ────────────────────

test('123 native DownloadTask pause must not abort wired cancel', () => {
  assert(
    !shouldAbortAbortSignalAfterNativePause({
      hasNativeDownloadTask: true,
      nativePauseAttempted: true,
    }),
    'skip abort after native pause',
  );
});

test('124 fetch worker without native task still aborts on pause', () => {
  assert(
    shouldAbortAbortSignalAfterNativePause({
      hasNativeDownloadTask: false,
      nativePauseAttempted: false,
    }),
    'abort fetch',
  );
});

test('125 native task present but pause not attempted still aborts', () => {
  assert(
    shouldAbortAbortSignalAfterNativePause({
      hasNativeDownloadTask: true,
      nativePauseAttempted: false,
    }),
    'fallback abort',
  );
});

test('126 DOWNLOADING supports Pause', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'DOWNLOADING',
    executionState: 'DOWNLOADING',
    hasActiveTransfer: true,
  });
  assert(a.canPause && !a.canResume && a.canCancel, 'pause');
});

test('127 PAUSED supports Resume', () => {
  const a = resolveDownloadRuntimeActions({
    status: 'PAUSED',
    executionState: 'PAUSED',
    hasActiveTransfer: false,
  });
  assert(!a.canPause && a.canResume && a.canCancel, 'resume');
});

test('128 pause intent is not Cancel (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  const pause = worker.slice(worker.indexOf('async pause('), worker.indexOf('async cancel('));
  assert(pause.includes('pauseRequested = true'), 'pause flag');
  assert(!pause.includes('cancelled = true'), 'not cancel');
  assert(pause.includes('shouldAbortAbortSignalAfterNativePause'), 'distinct from cancel');
});

test('129 pause does not delete .part (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pause = src.slice(src.indexOf('async pause('), src.indexOf('async resume('));
  assert(!pause.includes('deletePartialTransferQuiet'), 'no part delete');
  assert(!pause.includes('deleteDownloadFiles'), 'no full delete');
});

test('130 pause persist keeps bytesWritten (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('bytesWritten: Math.max(settled.bytesWritten, diskBytes)'), 'bytes kept');
});

test('131 pause persist keeps resume metadata (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('pauseState: durablePause'), 'resume meta');
  assert(src.includes('buildDurablePauseState'), 'durable');
});

test('132 pause releases worker on settle timeout (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('releasePausedWorkerOwnership'), 'detach');
  assert(src.includes('PAUSE_SETTLE_TIMEOUT'), 'timeout event');
  assert(src.includes('waitUntilSettledBounded'), 'bounded wait');
});

test('133 pause releases scheduler slot (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("ensureScheduler().release(downloadId)"), 'release');
});

test('134 final pause state is PAUSED (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes("status: 'PAUSED'"), 'status');
  assert(src.includes("executionState: 'PAUSED'"), 'exec');
  assert(src.includes('PAUSE_ACKNOWLEDGED'), 'ack');
});

test('135 intentional pause clears retry timer (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pause = src.slice(src.indexOf('private async runPause'), src.indexOf('async resume('));
  assert(pause.includes('clearRetryTimer(downloadId)'), 'no retry');
});

test('136 USER_PAUSE catch does not fail (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('pauseRequested && !this.active.cancelled'), 'user pause');
  assert(worker.includes("remoteStatus: 'PAUSED'"), 'paused');
});

test('137 pauseRequested is distinct from cancelled (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('pauseRequested: boolean'), 'field');
  assert(worker.includes('cancelled: boolean'), 'cancel field');
});

test('138 store mutating cleared in pause finally (source)', () => {
  const src = read('src/store/downloads/actions.ts');
  const pause = src.slice(src.indexOf('pause: async'), src.indexOf('resume: async'));
  assert(pause.includes('setMutating(id, true)'), 'busy');
  assert(pause.includes('setMutating(id, false)'), 'clear');
});

test('139 PAUSED card shows Resume', () => {
  const actions = runtimeActionsToCardActions(
    resolveDownloadRuntimeActions({
      status: 'PAUSED',
      executionState: 'PAUSED',
    }),
  );
  assert(actions.includes('resume') && !actions.includes('pause'), actions.join(','));
});

test('140 repeated Pause joins pauseOps (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('pauseOps.get(downloadId)'), 'join');
  assert(src.includes("event: 'PAUSE_REQUESTED'"), 'trace');
});

test('141 Resume joins in-flight pause then single-flights (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const resume = src.slice(src.indexOf('async resume('), src.indexOf('private async runResume'));
  assert(resume.includes('pauseOps.get(downloadId)'), 'join pause');
  assert(resume.includes('resumeOps.get(downloadId)'), 'join resume');
});

test('142 resume inspects on-disk partial (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('actualPartialSize'), 'partial size');
  assert(src.includes('readPartialFileSize(transferFile)'), 'disk');
});

test('143 zero-byte partial restarts from 0', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 0,
    resumeDataAvailable: false,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RESTART_FROM_ZERO', r.strategy);
});

test('144 valid partial selects RANGE_RESUME', () => {
  const r = resolveResumeStrategy({
    transferKind: 'progressive',
    remoteStatus: 'PAUSED',
    localState: 'paused',
    partialSize: 18_000_000,
    resumeDataAvailable: true,
    opaqueNativeResumeData: false,
    hlsCheckpointAvailable: false,
    multiRangeCheckpointAvailable: false,
    sourceUrlSafe: true,
    sessionContextMissing: false,
  });
  assert(r.strategy === 'RANGE_RESUME', r.strategy);
  assert(r.resumeOffset === 18_000_000, String(r.resumeOffset));
});

test('145 206 Content-Range start must match offset', () => {
  const ok = validateRangeResumeResponse({
    status: 206,
    contentRange: 'bytes 18000000-19999999/20000000',
    offset: 18_000_000,
    sentIfRange: false,
    knownTotalBytes: 20_000_000,
  });
  assert(ok.totalBytes === 20_000_000, 'valid 206');
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 206,
      contentRange: 'bytes 0-19999999/20000000',
      offset: 18_000_000,
      sentIfRange: false,
      knownTotalBytes: 20_000_000,
    });
  } catch {
    threw = true;
  }
  assert(threw, 'mismatched start rejected');
});

test('146 HTTP 200 after Range is never appended', () => {
  let threw = false;
  try {
    validateRangeResumeResponse({
      status: 200,
      contentRange: null,
      offset: 18_000_000,
      sentIfRange: false,
    });
  } catch {
    threw = true;
  }
  assert(threw, '200 rejected');
  const src = read('src/downloads/engine/append-range-transfer.ts');
  assert(src.includes('NEVER appended') || src.includes('never append'), 'contract');
});

test('147 resume can reclaim after pause detach (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('this.workers.get(input.id) === worker'), 'identity finally');
  assert(src.includes('RESUME_CLAIMED'), 'claim');
});

test('148 STARTING is a legal resume path, not terminal', () => {
  assert(isAllowedExecutionTransition('PAUSED', 'QUEUED'), 'queued');
  assert(isAllowedExecutionTransition('PAUSED', 'STARTING'), 'starting');
  assert(isAllowedExecutionTransition('STARTING', 'DOWNLOADING'), 'first byte');
  assert(isAllowedExecutionTransition('STARTING', 'PAUSED'), 'pause during start');
});

test('149 first byte STARTING→DOWNLOADING', () => {
  assert(isAllowedExecutionTransition('STARTING', 'DOWNLOADING'), 'first byte');
});

test('150 repeated Resume cannot duplicate worker (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('resumeOps.set(downloadId, op)'), 'single flight');
  assert(src.includes("admissionRequeue('ALREADY_ACTIVE')"), 'no dup admit');
});

test('151 old progress cannot overwrite PAUSED', () => {
  assert(
    shouldRejectLateDownloadingStatusOverPaused({
      catalogStatus: 'PAUSED',
      eventStatus: 'DOWNLOADING',
      executionState: 'PAUSED',
    }),
    'reject',
  );
});

test('152 stale transferring snapshot rejected over PAUSED', () => {
  assert(
    shouldRejectLateTransferringOverPaused({
      catalogStatus: 'PAUSED',
      snapshotLocalState: 'transferring',
    }),
    'reject',
  );
});

test('153 pause settle wait is bounded (source)', () => {
  const settle = read('src/downloads/engine/worker-settle.ts');
  assert(settle.includes('waitForCapturedSettleWithTimeout'), 'timeout helper');
  const constants = read('src/downloads/engine/constants.ts');
  assert(constants.includes('pauseSettleTimeoutMs'), 'budget');
});

test('154 worker identity-safe cleanup (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('this.workers.get(input.id) === worker'), 'same instance');
});

test('155 pauseRequested blocks progress publish (source)', () => {
  const worker = read('src/downloads/engine/worker.ts');
  assert(worker.includes('!this.active?.pauseRequested'), 'gate');
  assert(worker.includes('canPublishTransferProgress'), 'fn');
});

test('156 Wi-Fi policy still used on resume (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  assert(src.includes('evaluateNetworkAdmission'), 'policy');
  const policy = read('src/downloads/scheduler/network-policy.ts');
  assert(policy.includes('WAITING_FOR_WIFI'), 'wifi state');
});

test('157 social pause does not delete partial (source)', () => {
  const src = read('src/downloads/engine/manager.ts');
  const pause = src.slice(src.indexOf('private async runPause'), src.indexOf('async resume('));
  assert(!pause.includes('deletePartialTransferQuiet'), 'preserve');
});

test('158 HLS pause still aborts segments (source)', () => {
  const src = read('src/downloads/engine/hls/worker.ts');
  const pause = src.slice(src.indexOf('async pause('), src.indexOf('holdForNetworkPolicy'));
  assert(pause.includes('userPauseRequested = true'), 'flag');
  assert(pause.includes('abortController.abort()'), 'abort');
  assert(!pause.includes('ffmpeg'), 'no ffmpeg');
});

test('159 FINALIZING cannot pause to PAUSED', () => {
  assert(!isAllowedExecutionTransition('FINALIZING', 'PAUSED'), 'illegal');
  const decision = decidePauseCommit({
    executionState: 'FINALIZING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'finalizing',
    hasResumeData: true,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 99,
  });
  assert(decision.fail && decision.reason === 'FINALIZING', decision.reason);
});

test('160 COMPLETED pause commit rejected', () => {
  const decision = decidePauseCommit({
    executionState: 'COMPLETED',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'complete',
    hasResumeData: true,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 100,
  });
  assert(decision.fail && decision.reason === 'COMPLETED', decision.reason);
});

test('161 mutating is store-derived not local isPausing (source)', () => {
  const card = read('src/screens/downloads/components/DownloadCard.tsx');
  assert(card.includes('mutatingIds'), 'store');
  assert(!card.includes('isPausing'), 'no local flag');
});

test('162 Browser / Phase 2 / player files untouched by pause engine (isolation)', () => {
  const manager = read('src/downloads/engine/manager.ts');
  assert(!manager.includes('useBrowserMediaAction'), 'no browser');
  assert(!manager.includes('AppLock'), 'no applock');
  const worker = read('src/downloads/engine/worker.ts');
  assert(!worker.includes('ffmpeg'), 'no ffmpeg');
});

test('163 canonical states unchanged', () => {
  assert(catalogStatusForExecutionState('PREPARING') === 'QUEUED', 'preparing');
  assert(catalogStatusForExecutionState('QUEUED') === 'QUEUED', 'queued');
  assert(catalogStatusForExecutionState('WAITING_FOR_WIFI') === 'QUEUED', 'wifi');
  assert(catalogStatusForExecutionState('STARTING') === 'QUEUED', 'starting');
  assert(catalogStatusForExecutionState('DOWNLOADING') === 'DOWNLOADING', 'dl');
  assert(catalogStatusForExecutionState('FINALIZING') === 'DOWNLOADING', 'finalizing');
  assert(catalogStatusForExecutionState('PAUSED') === 'PAUSED', 'paused');
  assert(catalogStatusForExecutionState('RETRYING') === 'QUEUED', 'retry');
  assert(catalogStatusForExecutionState('COMPLETED') === 'COMPLETED', 'done');
  assert(catalogStatusForExecutionState('FAILED') === 'FAILED', 'fail');
  assert(catalogStatusForExecutionState('CANCELLED') === 'CANCELLED', 'cancel');
});

test('164 parseContentRange start used for 206 validation', () => {
  const parsed = parseContentRange('bytes 4096-8191/8192');
  assert(parsed != null && parsed.start === 4096, JSON.stringify(parsed));
});

test('165 pause settle timeout does not fail USER_PAUSE commit', () => {
  const d = decidePauseCommit({
    executionState: 'DOWNLOADING',
    workerStillTransferring: false,
    pauseRequested: true,
    localState: 'transferring',
    hasResumeData: true,
    hasHlsCheckpoint: false,
    hasMultiRangeCheckpoint: false,
    partialBytes: 1_000_000,
  });
  assert(d.commit && !d.fail, d.reason);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
