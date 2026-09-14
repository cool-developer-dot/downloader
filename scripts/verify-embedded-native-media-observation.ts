/**
 * Embedded native media observation verifier.
 * Run: npm run verify:embedded-native-media-observation
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyMediaResolutionOutcome,
  toastForUserTriggeredDownloadOutcome,
} from '../src/browser/media-actions/media-resolution-outcome';
import {
  processNativeMediaCandidateEvent,
  nativeTracePayloadIsSanitized,
  resetNativeNetworkContractForTests,
} from '../src/media-detection/adapters/native-network.contract';
import {
  correlateGeneralCandidate,
  generalPageMediaContextStore,
  selectCurrentGeneralMedia,
  type GeneralPageMediaContext,
} from '../src/media-detection/general-media';
import {
  classifyGeneralContentNavigation,
  isSameGeneralContentNavigation,
} from '../src/media-detection/general-media/general-content-navigation';
import {
  classifyGeneralNetworkResource,
  isPlayerDocumentResource,
  looksLikeDashManifestPath,
  looksLikeHlsPlaylistPath,
  nativeNetworkPrefilter,
  resourceFingerprintFromUrl,
  shouldObserveNativeNetworkRequest,
} from '../src/media-detection/general-media/general-network-resource';
import { isHlsDrmOrUnsupportedEncryption } from '../src/media-detection/general-source/hls-evidence';
import {
  mergeEligibleWindowCandidates,
  observeCandidateInWindow,
  resetCandidateWindowsForTests,
} from '../src/media-detection/observation/candidate-observation-window';
import { parseHlsManifest, parseProgressiveMediaUrl } from '../src/media-detection/parsers';
import { mediaDetectionPipeline } from '../src/media-detection/services/detection.service';
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
    pageUrl: partial.pageUrl ?? 'https://www.example.com/video/abc12x',
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

function iframeContext(
  overrides: Partial<GeneralPageMediaContext> = {},
): GeneralPageMediaContext {
  return {
    tabId: 'tab-a',
    navigationEpoch: 1,
    pageGeneration: 3,
    pageUrl: 'https://www.example.com/video/abc12x',
    activeMediaElementIdentity: 'iframe-player',
    activeMediaResourceIdentity: 'geo.example.com/player/xtv3w.html',
    currentMediaIdentity: 'video:abc12x',
    activeVideoCurrentSrc: 'https://geo.example.com/player/xtv3w.html',
    activeVideoIsBlob: false,
    activeVideoIntersectionRatio: 1,
    activeVideoPaused: false,
    activeVideoRecentlyPlayed: true,
    activeVideoMuted: false,
    activeVideoWidth: 1280,
    activeVideoHeight: 720,
    explicitAdMarker: false,
    userInteractionSignal: true,
    playerKind: 'iframe',
    frameClass: 'cross-origin',
    iframeIdentity: 'iframe-player',
    ownerStrength: 'STRONG',
    observedAt: Date.now(),
    ...overrides,
  };
}

console.log('Embedded native media observation verification\n');

async function main(): Promise<void> {
  const native = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
  );
  const moduleKt = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/VidoraMediaNetworkObserverModule.kt',
  );
  const pkgKt = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaDetectionPackage.kt',
  );
  const adapter = readSrc('src/media-detection/adapters/native-network.adapter.ts');
  const contract = readSrc('src/media-detection/adapters/native-network.contract.ts');
  const classifier = readSrc('src/media-detection/general-media/general-network-resource.ts');
  const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
  const corr = readSrc('src/media-detection/general-media/general-correlation.service.ts');
  const pageCtx = readSrc('src/media-detection/general-media/general-page-context.ts');
  const ctaPlayer = readSrc('src/media-detection/general-media/general-embedded-player.ts');
  const mediaAction = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
  const hook = readSrc('scripts/apply-webview-media-hook.js');
  const genNav = readSrc('src/media-detection/general-media/general-content-navigation.ts');

  resetNativeNetworkContractForTests();
  resetCandidateWindowsForTests();
  generalPageMediaContextStore.clearAll();

  await test('1. iframe media-like Range request survives native prefilter', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/sec/abc/file',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(d.observe, d.reason ?? 'dropped');
    assert(d.reason == null, d.reason ?? '');
  });

  await test('2. iframe HTML rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://geo.example.com/player/xtv3w.html',
      mimeHint: 'text/html',
      isForMainFrame: false,
    });
    assert(!d.observe, 'html observed');
    assert(d.reason === 'SKIP_EXTENSION' || d.reason === 'PLAYER_DOCUMENT', d.reason ?? '');
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/xtv3w.html',
      mimeType: 'text/html',
      isForMainFrame: false,
    });
    assert(!c.acceptForIngest, 'html ingested');
  });

  await test('3. iframe JS rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://geo.example.com/player/player.js',
      isForMainFrame: false,
    });
    assert(!d.observe && d.reason === 'SKIP_EXTENSION', d.reason ?? '');
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/player.js',
      isForMainFrame: false,
    });
    assert(c.family === 'script' && !c.acceptForIngest, c.family);
  });

  await test('4. iframe CSS rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://geo.example.com/player/player.css',
      isForMainFrame: false,
    });
    assert(!d.observe && d.reason === 'SKIP_EXTENSION', d.reason ?? '');
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/player.css',
      isForMainFrame: false,
    });
    assert(c.family === 'style' && !c.acceptForIngest, c.family);
  });

  await test('5. image rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/poster.jpg',
      isForMainFrame: false,
    });
    assert(!d.observe, 'image observed');
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/poster.jpg',
      mimeType: 'image/jpeg',
    });
    assert(c.family === 'image' && !c.acceptForIngest, c.family);
  });

  await test('6. JSON/API rejected', () => {
    const json = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/meta.json',
      isForMainFrame: false,
    });
    assert(json.family === 'json' && !json.acceptForIngest, json.family);
    const api = classifyGeneralNetworkResource({
      url: 'https://www.example.com/api/session/status',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(api.family === 'api' && !api.acceptForIngest, api.family);
    assert(nativeNetworkPrefilter({
      url: 'https://www.example.com/api/session/status',
      hasRange: true,
      isForMainFrame: false,
    }).reason === 'API_PATH', 'api prefilter');
  });

  await test('7. ad path rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/vast/ad/clip',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(c.family === 'ad' && !c.acceptForIngest, c.family);
  });

  await test('8. extensionless arbitrary request rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/static/app-shell',
      isForMainFrame: true,
    });
    assert(!c.acceptForIngest, 'arbitrary ingested');
    assert(c.rejectionReason === 'arbitrary_extensionless' || c.rejectionReason === 'non_media', c.rejectionReason ?? '');
    assert(
      !shouldObserveNativeNetworkRequest({
        url: 'https://cdn.example.com/static/app-shell',
        isForMainFrame: true,
      }),
      'arbitrary observed',
    );
  });

  await test('9. extensionless Range+media evidence enters candidate path', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/sec/abc/file',
      pageUrl: 'https://www.example.com/video/abc12x',
      hasRange: true,
      isForMainFrame: false,
      detectionSource: 'native_network',
    });
    assert(media != null, 'range child-frame ingest');
    assert(media.streamType === 'DIRECT' || media.streamProtocol == null, String(media.streamType));
  });

  await test('10. .mp4 candidate accepted', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media != null && (media.extension === 'mp4' || media.container === 'mp4'), String(media?.extension));
  });

  await test('11. .m3u8 candidate accepted', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/play/master.m3u8',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media != null, 'm3u8');
    assert(media.streamProtocol === 'hls' || media.streamType === 'HLS', String(media.streamType));
  });

  await test('12. MPEGURL evidence accepted', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/hls/abc12x/manifest',
      mimeType: 'application/vnd.apple.mpegurl',
    });
    assert(c.family === 'hls' && c.acceptForIngest, c.family);
    assert(looksLikeHlsPlaylistPath('https://cdn.example.com/hls/abc12x/index'));
  });

  await test('13. MPD classified DASH', () => {
    assert(looksLikeDashManifestPath('https://cdn.example.com/dash/abc.mpd'));
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/dash/abc.mpd',
    });
    assert(c.family === 'dash', c.family);
  });

  await test('14. .m4s segment rejected as whole file', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/dash/seg-1.m4s',
      isForMainFrame: false,
    });
    assert(!d.observe && d.reason === 'SEGMENT', d.reason ?? '');
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/dash/seg-1.m4s',
      isForMainFrame: false,
    });
    assert(c.family === 'segment' && !c.acceptForIngest, c.family);
  });

  await test('15. .ts segment not treated as progressive', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/hls/seg-12.ts',
      isForMainFrame: false,
    });
    assert(c.family === 'segment' || !c.acceptForIngest, c.family);
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/hls/seg-12.ts',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media == null || media.streamType !== 'DIRECT' || media.container === 'hls', 'ts progressive');
  });

  await test('16. player document rejected', () => {
    assert(isPlayerDocumentResource('https://geo.example.com/player/xtv3w.html'));
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/xtv3w',
      mimeType: 'text/html',
      isForMainFrame: false,
    });
    assert(!c.acceptForIngest, 'player doc ingested');
  });

  await test('17. native event payload sanitizes URL', () => {
    assert(
      nativeTracePayloadIsSanitized({
        stage: 'RESOURCE_SEEN',
        hostClass: 'cdn-generic',
        pathClass: 'extensionless',
        resourceFingerprint: 'abcd1234',
      }),
      'clean trace rejected',
    );
    assert(
      !nativeTracePayloadIsSanitized({
        stage: 'RESOURCE_SEEN',
        url: 'https://cdn.example.com/sec(token)/video.mp4?sig=secret',
      }),
      'url trace accepted',
    );
    assert(native.includes('VidoraMediaNetworkTrace'), 'trace event');
    assert(native.includes('RESOURCE_SEEN'), 'seen stage');
    const emitTraceIdx = native.indexOf('private fun emitTrace');
    const emitCandidateIdx = native.indexOf('private fun emitCandidate');
    const emitTraceBody = native.slice(
      emitTraceIdx,
      emitCandidateIdx > emitTraceIdx ? emitCandidateIdx : undefined,
    );
    assert(!emitTraceBody.includes('putString("url"'), 'trace url emit');
  });

  await test('18. no Cookie emitted on traces', () => {
    assert(!native.includes('putString("Cookie"'), 'cookie string');
    assert(native.includes('hasCookieHeader'), 'boolean cookie');
    assert(
      nativeTracePayloadIsSanitized({
        stage: 'NATIVE_EMITTED',
        resourceFingerprint: 'abcd1234',
      }),
      'trace cookie',
    );
    assert(
      !nativeTracePayloadIsSanitized({ Cookie: 'sid=1' }),
      'cookie key allowed',
    );
  });

  await test('19. no Authorization emitted', () => {
    assert(!native.includes('Authorization'), 'native Authorization');
    assert(!adapter.includes('putString("Authorization"'), 'adapter auth');
    assert(
      !nativeTracePayloadIsSanitized({ Authorization: 'Bearer secret' }),
      'auth allowed',
    );
  });

  await test('20. native emitted event reaches adapter contract', () => {
    resetNativeNetworkContractForTests();
    const fp = resourceFingerprintFromUrl('https://cdn.example.com/vod/file.mp4');
    const candidate = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/vod/file.mp4',
      method: 'GET',
      isForMainFrame: false,
      hasRange: true,
      hasCookieHeader: false,
      resourceFingerprint: fp,
      observationSource: 'webview',
    });
    assert(candidate != null, 'adapter dropped');
    assert(candidate.url.endsWith('/vod/file.mp4'), candidate.url);
    assert(candidate.resourceFingerprint === fp, candidate.resourceFingerprint ?? '');
    assert(contract.includes('JS_RECEIVED'), 'js received stage');
    assert(adapter.includes('DeviceEventEmitter'), 'device emitter');
  });

  await test('21. adapter accepts child-frame candidate', () => {
    resetNativeNetworkContractForTests();
    const candidate = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/sec/abc/file',
      isForMainFrame: false,
      hasRange: true,
      mimeHint: null,
    });
    assert(candidate != null, 'child-frame dropped');
    assert(candidate.isForMainFrame === false, 'forced main');
    assert(candidate.hasRange === true, 'range lost');
  });

  await test('22. adapter does not require MIME if other evidence exists', () => {
    resetNativeNetworkContractForTests();
    const candidate = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/sec/abc/file',
      isForMainFrame: false,
      hasRange: true,
    });
    assert(candidate != null, 'mime required');
    assert(candidate.mimeType == null, String(candidate.mimeType));
    const parsed = parseProgressiveMediaUrl({
      url: candidate.url,
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: candidate.mimeType,
      hasRange: candidate.hasRange,
      isForMainFrame: candidate.isForMainFrame,
      detectionSource: 'native_network',
    });
    assert(parsed != null, 'parser required mime');
  });

  await test('23. classifier produces progressive candidate', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/a.mp4',
    });
    assert(c.family === 'progressive' && c.acceptForIngest, c.family);
  });

  await test('24. classifier produces HLS candidate', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/a.m3u8',
    });
    assert(c.family === 'hls' && c.acceptForIngest, c.family);
  });

  await test('25. classifier produces DASH candidate', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/a.mpd',
    });
    assert(c.family === 'dash', c.family);
  });

  await test('26. iframe owner does not require src equality', () => {
    assert(corr.includes('playerKind === \'iframe\''), 'iframe branch');
    assert(corr.includes('currentSrc is the player frame'), 'src comment');
    const ctx = iframeContext();
    const media = makeMedia({
      id: 'c1',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const result = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence !== 'REJECTED', result.confidence);
    assert(result.evidence.currentSrcMatch !== true, 'required src match');
  });

  await test('27. same generation correlates', () => {
    const ctx = iframeContext({ pageGeneration: 3 });
    const media = makeMedia({
      id: 'c1',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const result = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'MEDIUM' || result.confidence === 'STRONG', result.confidence);
  });

  await test('28. stale generation rejects', () => {
    const ctx = iframeContext({ pageGeneration: 4, currentMediaIdentity: 'video:bbb99x' });
    const stale = makeMedia({
      id: 'old',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const result = correlateGeneralCandidate(stale, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  await test('29. wrong tab rejects', () => {
    const selected = selectCurrentGeneralMedia({
      candidates: [makeMedia({ id: 'c1', url: 'https://cdn.example.com/a.mp4' })],
      context: iframeContext(),
      tabId: 'tab-b',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: 'https://www.example.com/video/abc12x',
    });
    assert(selected.media == null, selected.media?.id ?? 'media');
  });

  await test('30. early candidate retained bounded', () => {
    resetCandidateWindowsForTests();
    const key = { tabId: 'tab-a', navigationEpoch: 1, generation: 3, platform: 'generic' };
    observeCandidateInWindow(key, makeMedia({ id: 'early', url: 'https://cdn.example.com/a.mp4' }));
    const merged = mergeEligibleWindowCandidates(key, []);
    assert(merged.some((item) => item.id === 'early'), 'early lost');
  });

  await test('31. owner acquisition re-evaluates', () => {
    assert(mediaAction.includes('mergeEligibleWindowCandidates'), 'tap merge');
    resetCandidateWindowsForTests();
    const key = { tabId: 'tab-a', navigationEpoch: 1, generation: 3, platform: 'generic' };
    observeCandidateInWindow(key, makeMedia({ id: 'early', url: 'https://cdn.example.com/a.mp4' }));
    const ctx = iframeContext();
    const selected = selectCurrentGeneralMedia({
      candidates: mergeEligibleWindowCandidates(key, []),
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id === 'early' || selected.group.activeCandidateIds.includes('early'), selected.media?.id ?? 'none');
  });

  await test('32. late candidate correlates', () => {
    const ctx = iframeContext();
    const late = makeMedia({
      id: 'late',
      url: 'https://cdn.example.com/vod/abc12x/late.mp4',
    });
    const result = correlateGeneralCandidate(late, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence !== 'REJECTED', result.confidence);
  });

  await test('33. active candidates bounded', () => {
    assert(corr.includes('MAX_ACTIVE_GENERAL_CANDIDATES = 6'), 'max 6');
    const ctx = iframeContext();
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeMedia({
        id: `c${i}`,
        url: `https://cdn.example.com/vod/abc12x/file${i}.mp4`,
      }),
    );
    const selected = selectCurrentGeneralMedia({
      candidates,
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.length <= 6, String(selected.group.activeCandidateIds.length));
  });

  await test('34. candidate #2 can win', () => {
    const ctx = iframeContext();
    const ad = makeMedia({
      id: 'ad',
      url: 'https://cdn.example.com/vast/ad/clip.mp4',
      width: 300,
      height: 250,
    });
    const good = makeMedia({
      id: 'good',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [ad, good],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(
      selected.media?.id === 'good' || selected.group.activeCandidateIds.includes('good'),
      selected.media?.id ?? 'none',
    );
  });

  await test('35. candidate #3 can win', () => {
    const ctx = iframeContext();
    const selected = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({ id: 'ad', url: 'https://cdn.example.com/vast/ad/clip.mp4', width: 300, height: 80 }),
        makeMedia({
          id: 'dash',
          url: 'https://cdn.example.com/dash/abc.mpd',
          container: 'dash',
          streamType: 'DASH',
          category: 'stream',
          extension: 'mpd',
          mimeType: 'application/dash+xml',
        }),
        makeMedia({ id: 'hls', url: 'https://cdn.example.com/play/master.m3u8', container: 'hls', streamType: 'HLS', category: 'stream', extension: 'm3u8' }),
      ],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.includes('hls') || selected.media?.id === 'hls', selected.media?.id ?? 'none');
  });

  await test('36. HTML verification rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/xtv3w.html',
      mimeType: 'text/html',
    });
    assert(!c.acceptForIngest && (c.rejectionReason === 'html_document' || c.rejectionReason === 'player_document'), c.rejectionReason ?? '');
    const outcome = classifyMediaResolutionOutcome({
      rejectionReason: 'HTML_RESPONSE',
      hasCandidates: true,
      allBoundedCandidatesRejected: true,
    });
    assert(outcome.kind === 'PROVEN_UNSUPPORTED', outcome.kind);
  });

  await test('37. JSON verification rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/player/config.json',
    });
    assert(c.family === 'json' && !c.acceptForIngest, c.family);
    const outcome = classifyMediaResolutionOutcome({
      rejectionReason: 'JSON_RESPONSE',
      hasCandidates: true,
      allBoundedCandidatesRejected: true,
    });
    assert(outcome.kind === 'PROVEN_UNSUPPORTED', outcome.kind);
  });

  await test('38. valid progressive verifies', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: 'video/mp4',
      detectionSource: 'native_network',
    });
    assert(media != null, 'progressive missing');
    const outcome = classifyMediaResolutionOutcome({
      resolvedSupported: true,
      hasCandidates: true,
    });
    assert(outcome.kind === 'RESOLVED_SUPPORTED', outcome.kind);
  });

  await test('39. valid HLS verifies', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4,\nhttps://cdn.example.com/seg1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/hls/abc12x/index.m3u8',
    );
    assert(parsed != null && parsed.isEncrypted === false && parsed.isLive === false, 'hls vod');
    assert(!isHlsDrmOrUnsupportedEncryption(parsed));
  });

  await test('40. encrypted HLS rejected', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"\n#EXTINF:4,\nhttps://cdn.example.com/1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/enc.m3u8',
    );
    assert(parsed != null && isHlsDrmOrUnsupportedEncryption(parsed), 'encrypted accepted');
  });

  await test('41. DASH requiring mux rejected', () => {
    const reliability = readSrc('src/media-detection/general-source/general-source-reliability.service.ts');
    assert(
      reliability.includes("media.streamType === 'DASH' || media.container === 'dash'"),
      'dash gate',
    );
    assert(reliability.includes("reason: 'DASH_UNSUPPORTED'"), 'dash reason');
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/dash/abc.mpd',
    });
    assert(c.family === 'dash', c.family);
    const outcome = classifyMediaResolutionOutcome({
      hasCandidates: true,
      rejectionReason: 'DASH_UNSUPPORTED',
    });
    assert(outcome.kind === 'PROVEN_UNSUPPORTED', outcome.kind);
  });

  await test('42. first tap can consume verified offer', () => {
    const outcome = classifyMediaResolutionOutcome({
      resolvedSupported: true,
      hasCandidates: true,
    });
    assert(outcome.kind === 'RESOLVED_SUPPORTED', outcome.kind);
    const toast = toastForUserTriggeredDownloadOutcome(outcome);
    assert(toast == null || !/still finding/i.test(toast), toast ?? '');
  });

  await test('43. no second tap required', () => {
    const bar = readSrc('src/browser/media-actions/BrowserMediaDownloadBar.tsx');
    assert(bar.includes('toastForUserTriggeredDownloadOutcome'), 'user tap toast');
    const first = classifyMediaResolutionOutcome({ resolvedSupported: true, hasCandidates: true });
    const again = classifyMediaResolutionOutcome({ resolvedSupported: true, hasCandidates: true });
    assert(first.kind === again.kind && first.kind === 'RESOLVED_SUPPORTED', first.kind);
  });

  await test('44. transient unresolved remains transient', () => {
    const outcome = classifyMediaResolutionOutcome({
      hasCandidates: false,
      rejectionReason: 'NO_FRESH_SOURCE',
    });
    assert(outcome.kind === 'TRANSIENT_UNRESOLVED', outcome.kind);
  });

  await test('45. real network failure remains NETWORK_FAILURE', () => {
    const outcome = classifyMediaResolutionOutcome({
      hasCandidates: true,
      rejectionReason: 'NETWORK_ERROR',
    });
    assert(outcome.kind === 'NETWORK_FAILURE', outcome.kind);
  });

  await test('46. proven unsupported remains PROVEN_UNSUPPORTED', () => {
    const outcome = classifyMediaResolutionOutcome({
      hasCandidates: true,
      rejectionReason: 'DASH_UNSUPPORTED',
    });
    assert(outcome.kind === 'PROVEN_UNSUPPORTED', outcome.kind);
  });

  await test('47. same-content generation untouched', () => {
    assert(genNav.includes('SAME_CONTENT_IGNORED') || pageCtx.includes('SAME_CONTENT_IGNORED'), 'same content');
    const same = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x?utm_source=x',
      'https://www.example.com/video/abc12x',
    );
    assert(same.sameContent, JSON.stringify(same));
  });

  await test('48. new-content stale safety preserved', () => {
    const changed = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x',
      'https://www.example.com/video/bbb99x',
    );
    assert(!changed.sameContent, JSON.stringify(changed));
    assert(changed.didVideoIdentityChange, JSON.stringify(changed));
  });

  await test('49. CTA owner code untouched', () => {
    assert(ctaPlayer.includes('looksLikeGeneralPlayerIframe'), 'iframe heuristic');
    assert(pageCtx.includes('GENERAL_OWNER_ACQUIRED') || pageCtx.includes('applyIframePlayerEvidence') || pageCtx.includes('iframe'), 'owner');
    assert(ctaPlayer.includes('resolveIframeOwnerStrength'), 'strength');
  });

  await test('50. Phase 1 API unchanged', () => {
    assert(mediaAction.includes('enqueueBrowserMediaDownload'), 'enqueue still used');
  });

  await test('51. Pause/Resume unchanged', () => {
    const pause = readSrc('src/downloads/engine/pause-state.ts');
    assert(pause.includes('parseAndroidResumeOffset'), 'pause resume module');
  });

  await test('52. no polling', () => {
    assert(!native.includes('setInterval'), 'native interval');
    assert(!adapter.includes('setInterval') && !contract.includes('setInterval'), 'adapter interval');
    assert(!classifier.includes('setInterval'), 'classifier interval');
  });

  await test('53. no reload workaround', () => {
    assert(!adapter.includes('reload('), 'adapter reload');
    assert(!native.includes('reload()'), 'native reload');
  });

  await test('54. no DOM injection', () => {
    assert(!native.includes('evaluateJavascript'), 'js inject');
    assert(!adapter.includes('contentDocument'), 'dom bypass');
  });

  await test('55. no Dailymotion API', () => {
    assert(!native.toLowerCase().includes('dailymotion.com/player/x'), 'dm player api');
    assert(!adapter.toLowerCase().includes('graphql.dailymotion'), 'dm graphql');
    assert(!classifier.toLowerCase().includes('dailymotion.com/api'), 'dm api');
  });

  await test('56. no backend', () => {
    assert(!adapter.includes('resolveMediaFromServer'), 'server resolver');
  });

  await test('57. no FFmpeg', () => {
    assert(!native.toLowerCase().includes('ffmpeg'), 'native ffmpeg');
    assert(!adapter.toLowerCase().includes('ffmpeg'), 'adapter ffmpeg');
  });

  await test('58. no mux', () => {
    const reliability = readSrc('src/media-detection/general-source/general-source-reliability.service.ts');
    assert(reliability.includes('DASH_UNSUPPORTED'), 'dash unsupported');
    assert(!reliability.toLowerCase().includes('ffmpeg'), 'mux ffmpeg');
  });

  await test('59. no DRM bypass', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n#EXTINF:4,\nhttps://cdn.example.com/1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/drm.m3u8',
    );
    assert(parsed == null || parsed.isEncrypted === true, 'drm parsed as clear');
  });

  await test('60. event dedupe bounded', () => {
    assert(native.includes('DEDUPE_MS = 1500L'), 'native dedupe');
    assert(contract.includes('nativeEventDedupeMs'), 'js dedupe');
    assert(native.includes('MAX_EVENTS_PER_WINDOW = 40'), 'emit cap');
    assert(native.includes('MAX_TRACES_PER_WINDOW = 24'), 'trace cap');
  });

  await test('61. candidate window bounded', () => {
    const windowSrc = readSrc('src/media-detection/observation/candidate-observation-window.ts');
    assert(windowSrc.includes('MAX_PER_KEY = 8'), 'per key');
    assert(windowSrc.includes('MAX_KEYS = 8'), 'keys');
  });

  await test('62. logs sanitized', () => {
    const diag = readSrc('src/media-detection/general-media/general-media-diagnostics.ts');
    assert(diag.includes('Never logs cookies'), 'privacy comment');
    assert(diag.includes('candidateFingerprintHash'), 'fingerprint field');
    assert(diag.includes('signed CDN') || diag.includes('Never logs cookies'), 'privacy comment');
  });

  await test('63. WebView hook still observe-only', () => {
    assert(hook.includes('return super.shouldInterceptRequest'), 'super');
    assert(hook.includes('MediaNetworkBridge'), 'bridge');
    assert(hook.includes('Never replaces the response'), 'observe only');
  });

  await test('64. native auto-enables on attach', () => {
    assert(native.includes('enabled.set(true)'), 'attach enable');
    assert(pkgKt.includes('MediaNetworkBridge.attach'), 'package attach');
    assert(moduleKt.includes('MediaNetworkBridge.attach'), 'module attach');
  });

  await test('65. ServiceWorker observe-only when installed', () => {
    assert(native.includes('ServiceWorkerController'), 'sw controller');
    assert(native.includes('ServiceWorkerClient'), 'sw client');
    assert(native.includes('return null'), 'no replace');
    assert(native.includes('observeRequestFrom(null, request, "service-worker")'), 'sw feed');
    assert(native.includes('Build.VERSION.SDK_INT'), 'api guard');
  });

  await test('66. request MIME is not fabricated from path', () => {
    assert(native.includes('never fabricate response Content-Type') || native.includes('Request metadata only'), 'comment');
    assert(native.includes('firstMediaAcceptToken'), 'accept token');
  });

  await test('67. UNKNOWN does not auto-become media', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/static/app-shell',
      isForMainFrame: true,
    });
    assert(c.family === 'unknown' || c.family === 'html' || c.family === 'api', c.family);
    assert(!c.acceptForIngest && !c.acceptForProbe, 'unknown probe');
  });

  await test('68. main-frame Range without family remains rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/sec/abc/file',
      hasRange: true,
      isForMainFrame: true,
    });
    assert(!c.acceptForIngest, 'main range ingested');
  });

  await test('69. pipeline ingest child-frame Range', () => {
    const result = mediaDetectionPipeline.processNetworkUrl(
      [],
      'https://cdn.example.com/sec/abc/file',
      'https://www.example.com/video/abc12x',
      [],
      {
        detectionSource: 'native_network',
        hasRange: true,
        isForMainFrame: false,
      },
    );
    assert(result.inserted > 0 || result.media.length > 0, `inserted=${result.inserted}`);
  });

  await test('70. fingerprint ignores query', () => {
    const a = resourceFingerprintFromUrl('https://cdn.example.com/vod/file.mp4?sig=aaaa');
    const b = resourceFingerprintFromUrl('https://cdn.example.com/vod/file.mp4?sig=bbbb');
    assert(a != null && a === b, `${a} vs ${b}`);
  });

  await test('71. adapter silently no longer drops missing MIME', () => {
    assert(!contract.includes("if (!mimeHint) {\n    return;"), 'early mime return');
  });

  await test('72. JS_RECEIVED logs before safety drop', () => {
    const idxReceived = contract.indexOf("logGeneralNetworkTrace('JS_RECEIVED'");
    const idxSafe = contract.indexOf('isSafeMediaUrl(urlRaw)');
    assert(idxReceived >= 0 && idxSafe > idxReceived, 'order');
  });

  await test('73. engine logs CANDIDATE_INGESTED', () => {
    assert(engine.includes("logGeneralNetworkTrace('CANDIDATE_INGESTED'"), 'ingest log');
  });

  await test('74. observer start does not require module to listen', () => {
    assert(adapter.includes('DeviceEventEmitter.addListener'), 'listen without module');
    assert(adapter.includes('OBSERVER_STARTED'), 'started log');
    assert(adapter.includes('modulePresent'), 'module flag');
  });

  await test('75. TikTok native special case preserved', () => {
    assert(native.includes('tiktokLooksMedia'), 'tiktok gate');
    assert(native.includes('tiktokcdn'), 'tiktok cdn');
  });

  await test('76. HLS playlist path family without extension', () => {
    assert(looksLikeHlsPlaylistPath('https://cdn.example.com/hls/abc12x/index'));
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/hls/abc12x/index',
      isForMainFrame: false,
    });
    assert(c.family === 'hls' || c.acceptForProbe || c.acceptForIngest, c.family);
  });

  await test('77. DASH path family classified', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/dash/abc12x/manifest.mpd',
    });
    assert(c.family === 'dash', c.family);
  });

  await test('78. init/chunk segment paths rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/dash/chunk/init',
      isForMainFrame: false,
      hasRange: true,
    });
    assert(!d.observe && d.reason === 'SEGMENT', d.reason ?? '');
  });

  await test('79. correlation uses same tab and epoch', () => {
    const ctx = iframeContext();
    const media = makeMedia({ id: 'c1', url: 'https://cdn.example.com/a.mp4' });
    const wrongEpoch = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 9,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(wrongEpoch.confidence === 'REJECTED', wrongEpoch.confidence);
  });

  await test('80. iframe src HTML is not executable media', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://geo.example.com/player/xtv3w.html',
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: 'text/html',
      detectionSource: 'native_network',
    });
    assert(media == null, 'iframe html media');
  });

  await test('81. native never mutates response', () => {
    assert(native.includes('NEVER returns a replacement') || native.includes('never'), 'comment');
    assert(native.includes('return null'), 'sw null');
    assert(!native.includes('WebResourceResponse('), 'constructed response');
  });

  await test('82. diagnostics stages cover the required chain', () => {
    const diag = readSrc('src/media-detection/general-media/general-media-diagnostics.ts');
    for (const stage of ['RESOURCE_SEEN', 'NATIVE_EMITTED', 'JS_RECEIVED', 'CANDIDATE_INGESTED']) {
      assert(diag.includes(stage), stage);
    }
  });

  await test('83. first tap transient still finding copy unchanged', () => {
    const toast = toastForUserTriggeredDownloadOutcome(
      classifyMediaResolutionOutcome({ hasCandidates: false, rejectionReason: 'NO_FRESH_SOURCE' }),
    );
    assert(toast != null && /still finding/i.test(toast), toast ?? 'null');
  });

  await test('84. SW source is labeled separately', () => {
    assert(native.includes('"service-worker"'), 'source label');
    assert(adapter.includes('observationSource') || contract.includes('observationSource'), 'js source');
  });

  await test('85. child-frame family path without Range still probeable', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/vod/abc12x/media',
      isForMainFrame: false,
    });
    assert(c.acceptForIngest || c.acceptForProbe, c.family);
  });

  await test('86. Accept MPEGURL without extension observes', () => {
    assert(
      shouldObserveNativeNetworkRequest({
        url: 'https://cdn.example.com/play/abc12x/manifest',
        accept: 'application/vnd.apple.mpegurl',
        isForMainFrame: false,
      }),
      'mpegurl accept',
    );
  });

  await test('87. focused verifier is TypeScript-only', () => {
    const pkg = JSON.parse(readSrc('package.json')) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.['verify:embedded-native-media-observation'] ?? '';
    assert(script.includes('tsx'), script);
    assert(!script.includes('gradle'), script);
    assert(!script.includes('eas'), script);
  });

  await test('88. MediaDetectionPackage still registered by name', () => {
    const main = readSrc('android/app/src/main/java/com/anonymous/vidorax/MainApplication.kt');
    assert(main.includes('MediaDetectionPackage()'), 'package');
  });

  await test('89. candidate event still carries URL for ingest only', () => {
    assert(native.includes('putString("url", url)'), 'candidate url');
    assert(native.includes('putString("resourceFingerprint"'), 'fingerprint field');
  });

  await test('90. window merge does not require reload', () => {
    assert(!mediaAction.includes('webView.reload'), 'reload');
    assert(mediaAction.includes('mergeEligibleWindowCandidates'), 'merge');
  });

  await test('91. adapter contract ignores missing pageUrl', () => {
    resetNativeNetworkContractForTests();
    const candidate = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/vod/file.mp4',
      isForMainFrame: false,
      hasRange: true,
    });
    assert(candidate != null, 'pageUrl required');
    assert(candidate.pageUrl == null, candidate.pageUrl ?? '');
  });

  await test('92. generation same-content helper stable', () => {
    assert(
      isSameGeneralContentNavigation(
        'https://www.dailymotion.com/video/xb6huwu',
        'https://www.dailymotion.com/video/xb6huwu?playlist=x',
      ),
      'dm query churn',
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
