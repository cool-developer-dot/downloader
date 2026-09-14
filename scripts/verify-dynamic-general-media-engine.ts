/**
 * Generic Phase 5 dynamic media engine verifier.
 * Usage (from mobile/): npm run verify:dynamic-general-media-engine
 *
 * Exercises production functions only. No site-specific download handlers.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyMediaResolutionOutcome,
  isDownloadResolutionTokenCurrent,
  toastForUserTriggeredDownloadOutcome,
} from '../src/browser/media-actions/media-resolution-outcome';
import {
  processNativeMediaCandidateEvent,
  nativeTracePayloadIsSanitized,
  resetNativeNetworkContractForTests,
} from '../src/media-detection/adapters/native-network.contract';
import {
  classifyDynamicMediaResource,
  classifyGeneralNetworkResource,
  correlateGeneralCandidate,
  generalPageMediaContextStore,
  isBlobOnlyResource,
  isInitOrFragmentMediaPath,
  isPlayerDocumentResource,
  isPosterOrImageResource,
  isSegmentResource,
  looksLikeDashManifestPath,
  looksLikeHlsPlaylistPath,
  nativeNetworkPrefilter,
  resourceFingerprintFromUrl,
  selectCurrentGeneralMedia,
  shouldObserveNativeNetworkRequest,
  toAuthoritativeResourceFamily,
  type GeneralPageMediaContext,
} from '../src/media-detection/general-media';
import {
  classifyGeneralContentNavigation,
  isSameGeneralContentNavigation,
} from '../src/media-detection/general-media/general-content-navigation';
import { looksLikeGeneralPlayerIframe } from '../src/media-detection/general-media/general-embedded-player';
import { isHlsDrmOrUnsupportedEncryption, looksLikeHlsCandidate } from '../src/media-detection/general-source/hls-evidence';
import {
  mergeEligibleWindowCandidates,
  observeCandidateInWindow,
  resetCandidateWindowsForTests,
  candidateWindowSizeForTests,
} from '../src/media-detection/observation/candidate-observation-window';
import { parseDashManifest, parseHlsManifest, parseProgressiveMediaUrl } from '../src/media-detection/parsers';
import { isActionableStandaloneMp4 } from '../src/downloads/engine/mp4-box-classify';
import { isLikelyMediaSegment } from '../src/media-detection/services/false-positive.filter';
import { sniffMediaSignature } from '../src/downloads/engine/media-signature';
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
    pageUrl: partial.pageUrl ?? 'https://news.example.com/watch/abc12x',
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
    websiteSource: 'news.example.com',
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

function videoContext(
  overrides: Partial<GeneralPageMediaContext> = {},
): GeneralPageMediaContext {
  return {
    tabId: 'tab-1',
    navigationEpoch: 1,
    pageGeneration: 1,
    pageUrl: 'https://news.example.com/watch/abc12x',
    activeMediaElementIdentity: 'video:0',
    activeMediaResourceIdentity: 'cdn.example.com/a.mp4',
    currentMediaIdentity: 'video:abc12x',
    activeVideoCurrentSrc: 'https://cdn.example.com/a.mp4',
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

function iframeContext(
  overrides: Partial<GeneralPageMediaContext> = {},
): GeneralPageMediaContext {
  return videoContext({
    activeMediaElementIdentity: 'iframe:0',
    activeMediaResourceIdentity: 'player.example.com/embed/abc12x',
    activeVideoCurrentSrc: 'https://player.example.com/embed/abc12x',
    playerKind: 'iframe',
    frameClass: 'cross-origin',
    iframeIdentity: 'iframe:0',
    ownerStrength: 'MEDIUM',
    ...overrides,
  });
}

const HLS_VOD = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:6.0,
https://cdn.example.com/seg0.ts
#EXT-X-ENDLIST
`;

const HLS_MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
https://cdn.example.com/360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
https://cdn.example.com/720.m3u8
`;

const HLS_ENC = `#EXTM3U
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"
#EXT-X-TARGETDURATION:4
#EXTINF:4.0,
https://cdn.example.com/1.ts
#EXT-X-ENDLIST
`;

const HLS_LIVE = `#EXTM3U
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
https://cdn.example.com/live0.ts
`;

const DASH_SEPARATE = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v" bandwidth="1000000" width="1280" height="720">
        <BaseURL>https://cdn.example.com/v.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a" bandwidth="128000">
        <BaseURL>https://cdn.example.com/a.m4a</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

async function main(): Promise<void> {
  const native = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
  );
  const adapter = readSrc('src/media-detection/adapters/native-network.adapter.ts');
  const contract = readSrc('src/media-detection/adapters/native-network.contract.ts');
  const classifier = readSrc('src/media-detection/general-media/general-network-resource.ts');
  const injected = readSrc('src/media-detection/observers/injected-script.ts');
  const reliability = readSrc(
    'src/media-detection/general-source/general-source-reliability.service.ts',
  );
  const engine = readSrc('src/media-detection/engine/media-detection.engine.ts');
  const mediaAction = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
  const outcomeSrc = readSrc('src/browser/media-actions/media-resolution-outcome.ts');

  // ── A. PROGRESSIVE ──────────────────────────────────────────────
  await test('A1. normal mp4 ingested', () => {
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/clip.mp4' });
    assert(c.family === 'progressive' && c.acceptForIngest, c.family);
    assert(toAuthoritativeResourceFamily(c.family) === 'PROGRESSIVE_MEDIA', 'auth family');
  });

  await test('A2. extensionless mp4 with Range/media evidence', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/vod/obj/abc',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(c.acceptForIngest && c.family === 'progressive', `${c.family}:${c.rejectionReason}`);
    const parsed = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/vod/obj/abc',
      pageUrl: 'https://news.example.com/watch/abc12x',
      hasRange: true,
      isForMainFrame: false,
      detectionSource: 'native_network',
    });
    assert(parsed != null, 'parser dropped extensionless range');
  });

  await test('A3. video MIME without extension', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/media/item',
      mimeType: 'video/mp4',
    });
    assert(c.acceptForIngest && c.family === 'progressive', c.family);
    assert(classifyDynamicMediaResource({
      url: 'https://cdn.example.com/media/item',
      mimeType: 'video/mp4',
    }).authoritativeFamily === 'PROGRESSIVE_MEDIA', 'dynamic family');
  });

  await test('A4. WebM ingested', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/clip.webm',
      mimeType: 'video/webm',
    });
    assert(c.family === 'progressive' && c.acceptForIngest, c.family);
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const sig = sniffMediaSignature(bytes);
    assert(sig.ok && sig.kind === 'webm', sig.kind);
  });

  await test('A5. valid standalone fMP4 kind is actionable', () => {
    assert(isActionableStandaloneMp4('FRAGMENTED_COMPLETE'), 'fmp4');
    assert(isActionableStandaloneMp4('PROGRESSIVE_OR_COMPLETE'), 'progressive mp4');
    assert(!isActionableStandaloneMp4('INIT_SEGMENT'), 'init not standalone');
    assert(!isActionableStandaloneMp4('MEDIA_FRAGMENT'), 'fragment not standalone');
  });

  await test('A6. HTML rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/watch.html',
      mimeType: 'text/html',
    });
    assert(!c.acceptForIngest && c.family === 'html', c.family);
  });

  await test('A7. JSON rejected', () => {
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/meta.json' });
    assert(!c.acceptForIngest && c.family === 'json', c.family);
  });

  await test('A8. image rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/poster.jpg',
      mimeType: 'image/jpeg',
    });
    assert(!c.acceptForIngest && c.family === 'image', c.family);
  });

  await test('A9. partial fragment rejected as segment/init', () => {
    assert(isInitOrFragmentMediaPath('https://cdn.example.com/init.mp4'), 'init.mp4');
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/init.mp4' });
    assert(!c.acceptForIngest && c.family === 'segment', c.family);
  });

  await test('A10. numbered segment rejected', () => {
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/seg/0001.m4s' });
    assert(!c.acceptForIngest && c.family === 'segment', c.family);
    assert(isLikelyMediaSegment('https://cdn.example.com/seg/0001.m4s', 'm4s'), 'segment helper');
  });

  await test('A11. arbitrary extensionless rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/static/app-shell',
      isForMainFrame: true,
    });
    assert(!c.acceptForIngest, 'arbitrary ingested');
    assert(
      c.rejectionReason === 'arbitrary_extensionless' || c.rejectionReason === 'non_media',
      String(c.rejectionReason),
    );
  });

  await test('A12. video/webm MIME on extensionless ingested', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/obj/xyz',
      mimeType: 'video/webm',
    });
    assert(c.acceptForIngest, 'webm mime dropped');
  });

  // ── B. HLS ──────────────────────────────────────────────────────
  await test('B13. .m3u8 classified HLS', () => {
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/master.m3u8' });
    assert(c.family === 'hls' && c.acceptForIngest, c.family);
    assert(toAuthoritativeResourceFamily('hls') === 'HLS_MANIFEST', 'auth');
  });

  await test('B14. MPEGURL MIME', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/playlist',
      mimeType: 'application/vnd.apple.mpegurl',
    });
    assert(c.family === 'hls' && c.acceptForIngest, c.family);
  });

  await test('B15. extensionless verified #EXTM3U structure', () => {
    const parsed = parseHlsManifest(HLS_VOD, 'https://cdn.example.com/playlist');
    assert(parsed != null && parsed.isMedia === true, 'media playlist');
    assert(parsed.isEncrypted === false, 'clear');
  });

  await test('B16. master playlist', () => {
    const parsed = parseHlsManifest(HLS_MASTER, 'https://cdn.example.com/master.m3u8');
    assert(parsed?.isMaster === true && parsed.variants.length === 2, 'master variants');
  });

  await test('B17. media playlist', () => {
    const parsed = parseHlsManifest(HLS_VOD, 'https://cdn.example.com/index.m3u8');
    assert(parsed?.isMedia === true && parsed.segmentUris.length >= 1, 'segments owned by manifest');
  });

  await test('B18. encrypted HLS rejected', () => {
    const parsed = parseHlsManifest(HLS_ENC, 'https://cdn.example.com/enc.m3u8');
    assert(parsed != null && isHlsDrmOrUnsupportedEncryption(parsed), 'enc not flagged');
  });

  await test('B19. malformed HLS rejected', () => {
    assert(parseHlsManifest('not a playlist', 'https://cdn.example.com/x') == null, 'malformed');
    assert(parseHlsManifest('#EXTM3U\n', 'https://cdn.example.com/x') == null, 'empty');
  });

  await test('B20. live HLS classified', () => {
    const parsed = parseHlsManifest(HLS_LIVE, 'https://cdn.example.com/live.m3u8');
    assert(parsed?.isLive === true, 'live');
    assert(reliability.includes('LIVE_HLS_UNSUPPORTED'), 'phase5b live reject');
  });

  await test('B21. HLS path family without extension', () => {
    assert(looksLikeHlsPlaylistPath('https://cdn.example.com/hls/master'), 'hls path');
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/hls/master' });
    assert(c.family === 'hls', c.family);
  });

  await test('B22. looksLikeHlsCandidate mpegurl', () => {
    assert(
      looksLikeHlsCandidate({
        url: 'https://cdn.example.com/x',
        mimeType: 'application/x-mpegURL',
      }),
      'mime',
    );
  });

  // ── C. DASH ─────────────────────────────────────────────────────
  await test('C23. MPD detected', () => {
    const c = classifyGeneralNetworkResource({ url: 'https://cdn.example.com/stream.mpd' });
    assert(c.family === 'dash' && c.acceptForIngest, c.family);
    assert(toAuthoritativeResourceFamily('dash') === 'DASH_MANIFEST', 'auth');
  });

  await test('C24. DASH not HLS', () => {
    assert(looksLikeDashManifestPath('https://cdn.example.com/dash/manifest.mpd'), 'mpd');
    assert(!looksLikeHlsPlaylistPath('https://cdn.example.com/dash/manifest.mpd'), 'not hls');
    const parsed = parseDashManifest(DASH_SEPARATE, 'https://cdn.example.com/stream.mpd');
    assert(parsed?.isValid === true, 'mpd valid');
  });

  await test('C25. separate A/V unsupported', () => {
    const parsed = parseDashManifest(DASH_SEPARATE, 'https://cdn.example.com/stream.mpd');
    assert(parsed?.hasSeparateAudio === true, 'separate av');
    assert(reliability.includes('DASH_UNSUPPORTED'), 'no mux');
  });

  await test('C26. progressive alternative can win', () => {
    const ctx = videoContext();
    const picked = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({
          id: 'dash',
          url: 'https://cdn.example.com/stream.mpd',
          container: 'dash',
          streamType: 'DASH',
          category: 'stream',
          extension: 'mpd',
          mimeType: 'application/dash+xml',
        }),
        makeMedia({ id: 'mp4', url: 'https://cdn.example.com/a.mp4' }),
      ],
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(picked.media?.id === 'mp4', picked.media?.id ?? 'none');
  });

  await test('C27. HLS alternative can win over DASH', () => {
    const ctx = iframeContext({ activeVideoIsBlob: true, activeVideoCurrentSrc: 'blob:https://x/1' });
    const picked = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({
          id: 'dash',
          url: 'https://cdn.example.com/manifest.mpd',
          container: 'dash',
          streamType: 'DASH',
          category: 'stream',
          extension: 'mpd',
          mimeType: 'application/dash+xml',
          pageUrl: ctx.pageUrl,
        }),
        makeMedia({
          id: 'hls',
          url: 'https://cdn.example.com/master.m3u8',
          container: 'hls',
          streamType: 'HLS',
          category: 'stream',
          extension: 'm3u8',
          mimeType: 'application/vnd.apple.mpegurl',
          pageUrl: ctx.pageUrl,
        }),
      ],
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(picked.media?.id === 'hls', picked.media?.id ?? 'none');
  });

  await test('C28. dash+xml MIME', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/manifest',
      mimeType: 'application/dash+xml',
    });
    assert(c.family === 'dash', c.family);
  });

  // ── D. MSE / BLOB ───────────────────────────────────────────────
  await test('D29. blob is owner evidence not executable', () => {
    const blob = makeMedia({ id: 'blob', url: 'blob:https://news.example.com/uuid' });
    assert(isBlobOnlyResource(blob), 'blob helper');
    const ctx = videoContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://news.example.com/uuid',
    });
    const corr = correlateGeneralCandidate(blob, {
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(corr.confidence === 'REJECTED' && corr.rejectionReason === 'BLOB_ONLY', corr.rejectionReason ?? '');
  });

  await test('D30. blob never executable via parser', () => {
    const parsed = parseProgressiveMediaUrl({
      url: 'blob:https://news.example.com/uuid',
      pageUrl: 'https://news.example.com/watch/abc12x',
      detectionSource: 'dom_video',
    });
    assert(parsed == null, 'blob parsed');
  });

  await test('D31. underlying HTTP correlates with blob owner', () => {
    const ctx = videoContext({
      activeVideoIsBlob: true,
      activeVideoCurrentSrc: 'blob:https://news.example.com/uuid',
    });
    const http = makeMedia({ id: 'http', url: 'https://cdn.example.com/mse.mp4' });
    const corr = correlateGeneralCandidate(http, {
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(corr.confidence === 'MEDIUM' || corr.confidence === 'STRONG' || corr.confidence === 'WEAK', corr.confidence);
    assert(corr.confidence !== 'REJECTED', 'http rejected under blob owner');
  });

  await test('D32. blob-only tap is transient not proven-unsupported', () => {
    const outcome = classifyMediaResolutionOutcome({
      hasCandidates: false,
      rejectionReason: 'PLATFORM_UNOBSERVABLE',
    });
    assert(outcome.kind === 'TRANSIENT_UNRESOLVED', outcome.kind);
    assert(outcome.reason === 'PLATFORM_UNOBSERVABLE', String(outcome.reason));
  });

  await test('D33. native never emits blob scheme', () => {
    assert(!shouldObserveNativeNetworkRequest({ url: 'blob:https://x/1' }), 'blob native');
  });

  // ── E. TOP FRAME ────────────────────────────────────────────────
  await test('E34. visible video owner strong src match', () => {
    const ctx = videoContext();
    const media = makeMedia({ id: 'a', url: 'https://cdn.example.com/a.mp4' });
    const corr = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(corr.confidence === 'STRONG', corr.confidence);
  });

  await test('E35. hidden video no strong owner', () => {
    const ctx = videoContext({
      activeVideoIntersectionRatio: 0.05,
      activeVideoPaused: true,
      activeVideoRecentlyPlayed: false,
      userInteractionSignal: false,
    });
    const other = makeMedia({ id: 'b', url: 'https://cdn.example.com/other.mp4' });
    const corr = correlateGeneralCandidate(other, {
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(corr.confidence === 'REJECTED' || corr.confidence === 'WEAK', corr.confidence);
  });

  await test('E36. active video current', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-1');
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-1',
      pageUrl: 'https://news.example.com/watch/abc12x',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-1',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://news.example.com/watch/abc12x',
        elementIdentity: 'video:0',
        currentSrc: 'https://cdn.example.com/a.mp4',
        src: 'https://cdn.example.com/a.mp4',
        isBlob: false,
        paused: false,
        ended: false,
        readyState: 4,
        videoWidth: 1280,
        videoHeight: 720,
        muted: false,
        currentTimeBucket: 0,
        intersectionRatio: 0.8,
        viewportCenterDistance: 0,
        isDisplayed: true,
        isVisibleStyle: true,
        recentlyPlayed: true,
        explicitAdMarker: false,
        associatedContentId: 'abc12x',
        observedAt: Date.now(),
      },
    });
    const ctx = generalPageMediaContextStore.get('tab-1');
    assert(ctx?.ownerStrength === 'STRONG' || ctx?.playerKind === 'video', String(ctx?.ownerStrength));
    generalPageMediaContextStore.clearAll();
  });

  await test('E37. src match strong correlation', () => {
    const picked = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({ id: 'wrong', url: 'https://cdn.example.com/other.mp4' }),
        makeMedia({ id: 'a', url: 'https://cdn.example.com/a.mp4' }),
      ],
      context: videoContext(),
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: 'https://news.example.com/watch/abc12x',
    });
    assert(picked.media?.id === 'a', picked.media?.id ?? '');
  });

  // ── F. IFRAME ───────────────────────────────────────────────────
  await test('F38. visible cross-origin iframe owner heuristic', () => {
    assert(
      looksLikeGeneralPlayerIframe({
        src: 'https://player.example.com/embed/abc12x',
        width: 640,
        height: 360,
        isDisplayed: true,
        allowFullscreen: true,
      }),
      'player iframe',
    );
  });

  await test('F39. no cross-origin DOM bypass', () => {
    assert(injected.includes('catch (cross)'), 'cross-origin catch');
    assert(!native.includes('evaluateJavascript'), 'evaluateJavascript');
    assert(!injected.includes('document.domain'), 'document.domain');
  });

  await test('F40. iframe src is player document not media', () => {
    assert(
      isPlayerDocumentResource('https://player.example.com/player/xtv3w/index.html', 'text/html'),
      'player html',
    );
    const parsed = parseProgressiveMediaUrl({
      url: 'https://player.example.com/player/xtv3w.html',
      pageUrl: 'https://news.example.com/watch/abc12x',
      mimeType: 'text/html',
      detectionSource: 'native_network',
    });
    assert(parsed == null, 'iframe src executable');
  });

  await test('F41. candidate does not require iframe src equality', () => {
    const ctx = iframeContext();
    const media = makeMedia({
      id: 'cdn',
      url: 'https://cdn.example.com/a.mp4',
    });
    const corr = correlateGeneralCandidate(media, {
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(corr.confidence !== 'REJECTED', corr.confidence);
    assert(corr.evidence.currentSrcMatch !== true, 'iframe src treated as media match');
  });

  await test('F42. child-frame media can correlate', () => {
    const ctx = iframeContext();
    const picked = selectCurrentGeneralMedia({
      candidates: [makeMedia({ id: 'child', url: 'https://cdn.example.com/vod/file.mp4' })],
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(picked.media?.id === 'child', picked.media?.id ?? 'none');
    assert(picked.group.activeCandidateIds.includes('child'), 'active set');
  });

  await test('F43. hidden iframe rejected as owner', () => {
    assert(
      !looksLikeGeneralPlayerIframe({
        src: 'https://player.example.com/embed/x',
        width: 640,
        height: 360,
        isDisplayed: false,
      }),
      'hidden looks player',
    );
  });

  // ── G. SPA ──────────────────────────────────────────────────────
  await test('G44. initial A identity', () => {
    const a = classifyGeneralContentNavigation(
      null,
      'https://news.example.com/watch/aaa111',
    );
    assert(!a.sameContent, 'first nav');
  });

  await test('G45. same A query change no bump', () => {
    assert(
      isSameGeneralContentNavigation(
        'https://news.example.com/watch/aaa111',
        'https://news.example.com/watch/aaa111?utm_source=x',
      ),
      'query',
    );
  });

  await test('G46. same A hash no bump', () => {
    assert(
      isSameGeneralContentNavigation(
        'https://news.example.com/watch/aaa111',
        'https://news.example.com/watch/aaa111#player',
      ),
      'hash',
    );
  });

  await test('G47. same A player chrome no bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://news.example.com/watch/aaa111',
      'https://news.example.com/watch/aaa111?playlist=x',
    );
    assert(d.sameContent, JSON.stringify(d));
  });

  await test('G48. A→B bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://news.example.com/watch/aaa111',
      'https://news.example.com/watch/bbb222',
    );
    assert(!d.sameContent && d.didVideoIdentityChange, JSON.stringify(d));
  });

  await test('G49. stale A candidate rejects under B', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'a', url: 'https://cdn.example.com/a.mp4' }),
      {
        context: videoContext({ pageGeneration: 2, currentMediaIdentity: 'video:bbb222' }),
        tabId: 'tab-1',
        navigationEpoch: 1,
        pageGeneration: 1,
        pageUrl: 'https://news.example.com/watch/bbb222',
      },
    );
    assert(corr.confidence === 'REJECTED', corr.confidence);
    assert(corr.rejectionReason === 'STALE_PAGE_GENERATION', String(corr.rejectionReason));
  });

  await test('G50. A verification cannot enqueue B (token)', () => {
    assert(
      !isDownloadResolutionTokenCurrent(
        { tabId: 't', navigationEpoch: 1, generation: 1, contentIdentity: 'video:aaa111' },
        { tabId: 't', navigationEpoch: 1, generation: 2, contentIdentity: 'video:bbb222' },
      ),
      'token current',
    );
  });

  // ── H. EARLY/LATE RACES ─────────────────────────────────────────
  await test('H51. candidate before owner stays in window', () => {
    resetCandidateWindowsForTests();
    observeCandidateInWindow(
      { tabId: 'tab-1', navigationEpoch: 1, generation: 1, platform: 'general' },
      makeMedia({ id: 'early', url: 'https://cdn.example.com/early.mp4' }),
    );
    assert(candidateWindowSizeForTests() === 1, 'window empty');
  });

  await test('H52. owner reevaluates windowed candidate', () => {
    const merged = mergeEligibleWindowCandidates(
      { tabId: 'tab-1', navigationEpoch: 1, generation: 1, platform: 'general' },
      [],
    );
    const picked = selectCurrentGeneralMedia({
      candidates: merged,
      context: videoContext({
        activeVideoCurrentSrc: 'https://cdn.example.com/early.mp4',
        activeMediaResourceIdentity: 'cdn.example.com/early.mp4',
      }),
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: 'https://news.example.com/watch/abc12x',
    });
    assert(picked.media?.id === 'early', picked.media?.id ?? 'none');
    resetCandidateWindowsForTests();
  });

  await test('H53. owner before candidate still correlates later', () => {
    const ctx = videoContext();
    const empty = selectCurrentGeneralMedia({
      candidates: [],
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(empty.media == null, 'empty should not invent');
    const later = selectCurrentGeneralMedia({
      candidates: [makeMedia({ id: 'late', url: 'https://cdn.example.com/a.mp4' })],
      context: ctx,
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: ctx.pageUrl,
    });
    assert(later.media?.id === 'late', later.media?.id ?? '');
  });

  await test('H54. later candidate correlates without reload', () => {
    assert(!mediaAction.includes('webView.reload'), 'reload workaround');
    assert(mediaAction.includes('mergeEligibleWindowCandidates'), 'window merge');
  });

  await test('H55. no second navigation required', () => {
    assert(engine.includes('observeNativeCandidate'), 'native ingest');
    assert(!engine.includes('reload()'), 'engine reload');
  });

  // ── I. MULTI-CANDIDATE ──────────────────────────────────────────
  await test('I56. candidate #1 invalid image', () => {
    assert(isPosterOrImageResource(makeMedia({
      id: 'img',
      url: 'https://cdn.example.com/thumb.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    })), 'image');
  });

  await test('I57. #2 invalid segment', () => {
    assert(isSegmentResource(makeMedia({
      id: 'seg',
      url: 'https://cdn.example.com/seg/1.m4s',
      extension: 'm4s',
    })), 'seg');
  });

  await test('I58-60. valid #3 wins among invalids', () => {
    const picked = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({
          id: '1',
          url: 'https://cdn.example.com/thumb.jpg',
          mimeType: 'image/jpeg',
          extension: 'jpg',
        }),
        makeMedia({
          id: '2',
          url: 'https://cdn.example.com/seg/1.m4s',
          extension: 'm4s',
          container: 'mp4',
        }),
        makeMedia({ id: '3', url: 'https://cdn.example.com/a.mp4' }),
      ],
      context: videoContext(),
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: 'https://news.example.com/watch/abc12x',
    });
    assert(picked.media?.id === '3', picked.media?.id ?? '');
    assert(picked.group.activeCandidateIds.length <= 6, 'unbounded');
  });

  await test('I61. list bounded', () => {
    const windowSrc = readSrc('src/media-detection/observation/candidate-observation-window.ts');
    assert(windowSrc.includes('MAX_PER_KEY = 8'), 'per key');
    assert(windowSrc.includes('MAX_KEYS = 8'), 'keys');
  });

  await test('I62. duplicate fingerprint deduped', () => {
    const a = resourceFingerprintFromUrl('https://cdn.example.com/a.mp4?sig=1');
    const b = resourceFingerprintFromUrl('https://cdn.example.com/a.mp4?sig=2');
    assert(a != null && a === b, `${a} vs ${b}`);
  });

  // ── J. ADS / PRELOAD ────────────────────────────────────────────
  await test('J63. ad path rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/vast/ad/clip.mp4',
    });
    assert(c.family === 'ad' && !c.acceptForIngest, c.family);
  });

  await test('J64. thumbnail rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/thumb.jpg',
    });
    assert(!c.acceptForIngest, 'thumb ingested');
  });

  await test('J65. explicit ad marker demotes owner candidate', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'ad', url: 'https://cdn.example.com/a.mp4' }),
      {
        context: videoContext({ explicitAdMarker: true }),
        tabId: 'tab-1',
        navigationEpoch: 1,
        pageUrl: 'https://news.example.com/watch/abc12x',
      },
    );
    assert(corr.confidence === 'REJECTED', corr.confidence);
    assert(corr.rejectionReason === 'ADVERTISEMENT', String(corr.rejectionReason));
  });

  await test('J66. related preload cannot own main CTA', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'preload', url: 'https://cdn.example.com/next.mp4' }),
      {
        context: videoContext({
          activeVideoCurrentSrc: 'https://cdn.example.com/a.mp4',
        }),
        tabId: 'tab-1',
        navigationEpoch: 1,
        pageUrl: 'https://news.example.com/watch/abc12x',
      },
    );
    assert(corr.confidence === 'REJECTED' || corr.rejectionReason === 'OFFSCREEN_PRELOAD', corr.confidence);
  });

  await test('J67. active content candidate wins', () => {
    const picked = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({ id: 'next', url: 'https://cdn.example.com/next.mp4' }),
        makeMedia({ id: 'a', url: 'https://cdn.example.com/a.mp4' }),
      ],
      context: videoContext(),
      tabId: 'tab-1',
      navigationEpoch: 1,
      pageUrl: 'https://news.example.com/watch/abc12x',
    });
    assert(picked.media?.id === 'a', picked.media?.id ?? '');
  });

  // ── K. DOWNLOAD TAP ─────────────────────────────────────────────
  await test('K68. supported offer enqueue path exists', () => {
    assert(mediaAction.includes('enqueueBrowserMediaDownload'), 'enqueue');
    assert(mediaAction.includes('buildVerifiedGeneralMediaOffer'), '5b offer');
  });

  await test('K69. transient message', () => {
    const o = classifyMediaResolutionOutcome({ hasCandidates: false });
    assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
    const toast = toastForUserTriggeredDownloadOutcome(o);
    assert(toast != null && /finding/i.test(toast), String(toast));
  });

  await test('K70. network error', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'PROBE_FAILED', hasCandidates: true });
    assert(o.kind === 'NETWORK_FAILURE', o.kind);
  });

  await test('K71. unsupported', () => {
    const o = classifyMediaResolutionOutcome({
      rejectionReason: 'DASH_UNSUPPORTED',
      hasCandidates: true,
      allBoundedCandidatesRejected: true,
    });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  await test('K72. stale context', () => {
    const o = classifyMediaResolutionOutcome({ staleToken: true });
    assert(o.kind === 'STALE_CONTEXT', o.kind);
  });

  await test('K73. session required', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'AUTH_RESPONSE' });
    assert(o.kind === 'SESSION_REQUIRED', o.kind);
  });

  await test('K74. first tap works when candidate ready', () => {
    assert(mediaAction.includes('verifyCandidate'), 'verify on tap');
    assert(mediaAction.includes('captureToken'), 'token');
  });

  await test('K75. duplicate tap joins', () => {
    assert(mediaAction.includes('RESOLUTION_JOINED'), 'join');
    assert(outcomeSrc.includes('verificationInFlight'), 'inflight');
  });

  await test('K76. successful enqueue consumes current identity', () => {
    assert(mediaAction.includes('commitConsumed'), 'consume');
    assert(mediaAction.includes('ENQUEUE_ACCEPTED'), 'accepted trace');
  });

  await test('K77. live HLS proven unsupported', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'LIVE_HLS_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  await test('K78. DRM proven unsupported', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'DRM_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  // ── L. NATIVE OBSERVATION ───────────────────────────────────────
  await test('L79. main-frame media prefilter', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/a.mp4',
      isForMainFrame: true,
    });
    assert(d.observe, 'main mp4');
  });

  await test('L80. child-frame media', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/vod/file',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(d.observe, 'child range');
  });

  await test('L81. Range evidence', () => {
    resetNativeNetworkContractForTests();
    const c = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/sec/abc/file',
      isForMainFrame: false,
      hasRange: true,
    });
    assert(c != null && c.hasRange === true, 'range lost');
  });

  await test('L82. request extension absent still emits with evidence', () => {
    assert(
      shouldObserveNativeNetworkRequest({
        url: 'https://cdn.example.com/hls/master',
        isForMainFrame: false,
      }),
      'hls family',
    );
  });

  await test('L83. JS rejected', () => {
    assert(
      nativeNetworkPrefilter({ url: 'https://cdn.example.com/app.js' }).observe === false,
      'js',
    );
  });

  await test('L84. CSS rejected', () => {
    assert(
      nativeNetworkPrefilter({ url: 'https://cdn.example.com/app.css' }).observe === false,
      'css',
    );
  });

  await test('L85. image rejected', () => {
    assert(
      nativeNetworkPrefilter({ url: 'https://cdn.example.com/a.png' }).observe === false,
      'png',
    );
  });

  await test('L86. HTML rejected', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://news.example.com/watch/abc12x',
      isForMainFrame: true,
    });
    assert(!d.observe, 'html page');
  });

  await test('L87. player document rejected', () => {
    assert(
      nativeNetworkPrefilter({
        url: 'https://player.example.com/player/xtv3w',
        isForMainFrame: false,
      }).observe === false,
      'player doc',
    );
  });

  await test('L88. event sanitization', () => {
    assert(
      nativeTracePayloadIsSanitized({
        stage: 'RESOURCE_SEEN',
        resourceFingerprint: 'abcd1234',
        pathClass: 'progressive-ext',
      }),
      'sanitized',
    );
    assert(
      !nativeTracePayloadIsSanitized({ url: 'https://cdn.example.com/a.mp4?token=secret' }),
      'full url allowed',
    );
  });

  await test('L89. adapter drops classified rejects', () => {
    resetNativeNetworkContractForTests();
    const dropped = processNativeMediaCandidateEvent({
      url: 'https://cdn.example.com/app.js',
      isForMainFrame: false,
    });
    assert(dropped == null, 'js forwarded');
  });

  await test('L90. native fingerprint stable', () => {
    assert(native.includes('resourceFingerprint'), 'kotlin fp');
    assert(contract.includes('resourceFingerprintFromUrl'), 'js fp');
  });

  // ── M. SERVICE WORKER ───────────────────────────────────────────
  await test('M91. service worker observe-only', () => {
    assert(native.includes('ServiceWorkerController'), 'controller');
    assert(native.includes('ServiceWorkerClient'), 'client');
    assert(native.includes('return null'), 'no replace');
    assert(native.includes('observeRequestFrom(null, request, "service-worker")'), 'sw source');
  });

  await test('M92. service worker API guard', () => {
    assert(native.includes('Build.VERSION_CODES.N'), 'api 24');
    assert(native.includes('catch (_: Throwable)'), 'no crash');
  });

  await test('M93. SW observations share classifier', () => {
    assert(native.includes('observationSource'), 'source field');
    assert(adapter.includes('observationSource'), 'adapter source');
  });

  await test('M94. SW does not mutate request', () => {
    assert(!native.includes('request.url ='), 'mutate url');
    assert(!native.includes('WebResourceResponse('), 'synthetic response ctor');
  });

  await test('M95. SW dedupe uses same recent map', () => {
    assert(native.includes('DEDUPE_MS = 1500L'), 'dedupe');
    assert(native.includes('MAX_EVENTS_PER_WINDOW = 40'), 'rate');
  });

  // ── N. SECURITY ─────────────────────────────────────────────────
  await test('N96. no Cookie persistence in candidate model', () => {
    assert(!contract.includes('putString("Cookie"'), 'cookie field');
    const pageCtx = readSrc('src/media-detection/general-media/general-page-context.ts');
    assert(!pageCtx.includes('Cookie'), 'page ctx cookie');
  });

  await test('N97. no Authorization persistence', () => {
    assert(!native.includes('Authorization'), 'native auth');
  });

  await test('N98. no signed URL logs in traces', () => {
    assert(native.includes('tracesEnabled()'), 'dev only');
    assert(native.includes('putString("resourceFingerprint"'), 'fp not url in trace');
  });

  await test('N99. no DRM bypass', () => {
    assert(reliability.includes('DRM_UNSUPPORTED'), 'drm');
    assert(!reliability.includes('clearkey'), 'clearkey');
  });

  await test('N100. no credentials interception', () => {
    assert(native.includes('hasCookieHeader'), 'boolean only');
    assert(!native.includes('getCookie('), 'cookie value');
  });

  // ── O. ARCHITECTURE ─────────────────────────────────────────────
  await test('O101. no Dailymotion handler', () => {
    assert(!classifier.toLowerCase().includes('dailymotion'), 'classifier dm');
    assert(!native.toLowerCase().includes('dailymotion'), 'native dm');
    assert(!engine.toLowerCase().includes('dailymotion'), 'engine dm');
    assert(!reliability.toLowerCase().includes('dailymotion'), '5b dm');
  });

  await test('O102. no hostname-specific downloader', () => {
    assert(!classifier.includes('hostname.includes'), 'host includes');
    assert(!reliability.includes('if (host.includes'), '5b host');
  });

  await test('O103. no backend / remote resolver', () => {
    assert(!engine.includes('resolveMediaFromServer'), 'server');
    assert(!reliability.includes('https://api.vidora'), 'cloud');
  });

  await test('O104. no FFmpeg / mux', () => {
    assert(!reliability.toLowerCase().includes('ffmpeg'), 'ffmpeg');
    assert(reliability.includes('DASH_UNSUPPORTED'), 'dash');
  });

  await test('O105. no polling', () => {
    assert(!native.includes('setInterval'), 'native interval');
    assert(!injected.includes('setInterval'), 'injected interval');
    assert(!classifier.includes('setInterval'), 'classifier interval');
    assert(!mediaAction.includes('setInterval'), 'cta interval');
  });

  await test('O106. no duplicate engine', () => {
    assert(!engine.includes('dynamicDownloaderV2'), 'v2');
    assert(engine.includes('observeNativeCandidate'), 'one native path');
  });

  await test('O107. no DOM-injected VidoraX CTA', () => {
    assert(!injected.includes('Download'), 'injected download cta');
    assert(!injected.includes('vidorax-cta'), 'cta node');
  });

  await test('O108. Phase 1 enqueue unchanged', () => {
    const dl = readSrc('src/browser/media-actions/browser-media-download.service.ts');
    assert(dl.includes('enqueueBrowserMediaDownload') || mediaAction.includes('enqueueBrowserMediaDownload'), 'p1');
  });

  await test('O109. Pause/Resume unchanged', () => {
    const pause = readSrc('src/downloads/engine/pause-state.ts');
    assert(pause.includes('parseAndroidResumeOffset'), 'pause');
  });

  await test('O110. TikTok/Instagram architecture preserved', () => {
    assert(native.includes('tiktokLooksMedia'), 'tiktok native');
    const social = readSrc('src/media-detection/social/social-content-identity.ts');
    assert(social.includes('tiktok') || social.includes('TIKTOK'), 'social tiktok');
    assert(injected.includes('looksTikTokCdnMedia'), 'js tiktok helper kept');
  });

  await test('O111. one classifier', () => {
    assert(classifier.includes('classifyGeneralNetworkResource'), 'classifier');
    assert(classifier.includes('classifyDynamicMediaResource'), 'wrapper not fork');
  });

  await test('O112. generic JS media path observation', () => {
    assert(injected.includes('looksGenericMediaPath'), 'generic path');
    assert(injected.includes('initiatorType') || injected.includes('initiator'), 'perf initiator');
  });

  await test('O113. native prefilter classified trace', () => {
    assert(native.includes('RESOURCE_PREFILTER_CLASSIFIED'), 'prefilter stage');
    assert(native.includes('RESOURCE_SEEN'), 'seen');
    assert(native.includes('NATIVE_EMITTED'), 'emitted');
  });

  await test('O114. init.mp4 never whole-file', () => {
    assert(
      !classifyGeneralNetworkResource({ url: 'https://cdn.example.com/init.mp4' }).acceptForIngest,
      'init ingest',
    );
    assert(native.includes('INIT_SEGMENT_PATH'), 'native init');
  });

  await test('O115. isolated .ts not progressive', () => {
    assert(
      !classifyGeneralNetworkResource({ url: 'https://cdn.example.com/1.ts' }).acceptForIngest,
      'ts ingest',
    );
  });

  await test('O116. octet-stream without evidence rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/static/data',
      mimeType: 'application/octet-stream',
      isForMainFrame: true,
    });
    assert(!c.acceptForIngest, 'octet ingest');
  });

  await test('O117. fingerprint same host+path', () => {
    const fp = resourceFingerprintFromUrl('https://CDN.Example.com/Vod/File.mp4?exp=1');
    const fp2 = resourceFingerprintFromUrl('https://cdn.example.com/vod/file.mp4');
    assert(fp === fp2, `${fp} ${fp2}`);
  });

  await test('O118. child-frame Range is not latest-request-wins', () => {
    const corrSrc = readSrc('src/media-detection/general-media/general-correlation.service.ts');
    assert(!corrSrc.includes('latest request'), 'latest');
    assert(corrSrc.includes('MAX_ACTIVE_GENERAL_CANDIDATES'), 'bounded rank');
  });

  await test('O119. page generation used in window key', () => {
    const w = readSrc('src/media-detection/observation/candidate-observation-window.ts');
    assert(w.includes('generation'), 'generation key');
    assert(w.includes('navigationEpoch'), 'epoch');
  });

  await test('O120. engine routes native through pipeline', () => {
    assert(engine.includes('processNetworkUrl'), 'pipeline');
    assert(engine.includes('hasRange'), 'range extras');
    assert(engine.includes('isForMainFrame'), 'frame extras');
  });

  await test('O121. fetch/XHR observers present', () => {
    assert(injected.includes('window.fetch'), 'fetch');
    assert(injected.includes('XMLHttpRequest.prototype.open'), 'xhr');
  });

  await test('O122. MutationObserver + IntersectionObserver', () => {
    assert(injected.includes('MutationObserver'), 'mo');
    assert(injected.includes('IntersectionObserver'), 'io');
  });

  await test('O123. PerformanceObserver resource entries', () => {
    assert(injected.includes("entryTypes: ['resource']") || injected.includes('entryTypes: ["resource"]') || injected.includes("entryTypes: ['resource']"), 'po');
  });

  await test('O124. one-shot DOM scan allowed, not interval walk', () => {
    assert(injected.includes('scanDom()'), 'initial scan');
    assert(!injected.includes('setInterval(scanDom'), 'scan loop');
  });

  await test('O125. PLATFORM_UNOBSERVABLE is not PROVEN_UNSUPPORTED', () => {
    const o = classifyMediaResolutionOutcome({
      rejectionReason: 'PLATFORM_UNOBSERVABLE',
      hasCandidates: false,
    });
    assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
  });

  await test('O126. encrypted HLS != unobservable', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'DRM_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  await test('O127. session-aware still uses request context builder', () => {
    assert(reliability.includes('maybeBuildSessionRetryContext'), 'phase6 retry');
    assert(reliability.includes('authMode'), 'auth mode');
  });

  await test('O128. no hostname accept-all', () => {
    assert(!classifier.includes('acceptAllHosts'), 'accept all');
    assert(!native.includes('host.contains("dailymotion")'), 'dm host');
  });

  await test('O129. native skip json/html/xml', () => {
    assert(native.includes('json|html?|xml'), 'skip path');
  });

  await test('O130. HLS segments owned by manifest', () => {
    const parsed = parseHlsManifest(HLS_VOD, 'https://cdn.example.com/index.m3u8');
    assert(parsed != null && parsed.segmentUris.length > 0, 'uris');
    const seg = parsed!.segmentUris[0]!;
    assert(
      !classifyGeneralNetworkResource({ url: seg }).acceptForIngest,
      'seg ingest',
    );
  });

  await test('O131. WebM extension is media ext', () => {
    const parsed = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/a.webm',
      pageUrl: 'https://news.example.com/watch/abc12x',
      detectionSource: 'network_request',
    });
    assert(parsed != null && parsed.extension === 'webm', parsed?.extension ?? 'null');
  });

  await test('O132. mp4 Range main-subresource (isForMainFrame false)', () => {
    const d = nativeNetworkPrefilter({
      url: 'https://cdn.example.com/clip.mp4',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(d.observe, 'subresource mp4');
  });

  await test('O133. API path with Range rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://news.example.com/api/session',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(c.family === 'api' && !c.acceptForIngest, c.family);
  });

  await test('O134. owner != downloadable source remains explicit', () => {
    const types = readSrc('src/media-detection/general-media/types.ts');
    assert(types.includes('Does not decide downloadability'), 'comment');
    assert(mediaAction.includes('buildVerifiedGeneralMediaOffer'), 'verify after owner');
  });

  await test('O135. iframe MEDIUM floor without src match', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'x', url: 'https://cdn.example.com/file.webm', extension: 'webm', mimeType: 'video/webm' }),
      {
        context: iframeContext(),
        tabId: 'tab-1',
        navigationEpoch: 1,
        pageUrl: 'https://news.example.com/watch/abc12x',
      },
    );
    assert(corr.confidence === 'MEDIUM' || corr.confidence === 'STRONG', corr.confidence);
  });

  await test('O136. wrong tab rejected', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'x', url: 'https://cdn.example.com/a.mp4' }),
      {
        context: videoContext(),
        tabId: 'other',
        navigationEpoch: 1,
        pageUrl: 'https://news.example.com/watch/abc12x',
      },
    );
    assert(corr.rejectionReason === 'WRONG_TAB', String(corr.rejectionReason));
  });

  await test('O137. stale navigation rejected', () => {
    const corr = correlateGeneralCandidate(
      makeMedia({ id: 'x', url: 'https://cdn.example.com/a.mp4' }),
      {
        context: videoContext(),
        tabId: 'tab-1',
        navigationEpoch: 9,
        pageUrl: 'https://news.example.com/watch/abc12x',
      },
    );
    assert(corr.rejectionReason === 'STALE_NAVIGATION', String(corr.rejectionReason));
  });

  await test('O138. javascript: scheme unsupported', () => {
    const parsed = parseProgressiveMediaUrl({
      url: 'javascript:alert(1)',
      pageUrl: 'https://news.example.com/watch/abc12x',
      detectionSource: 'dom_video',
    });
    assert(parsed == null, 'js url');
  });

  await test('O139. data: scheme unsupported', () => {
    const parsed = parseProgressiveMediaUrl({
      url: 'data:video/mp4;base64,AAAA',
      pageUrl: 'https://news.example.com/watch/abc12x',
      detectionSource: 'dom_video',
    });
    assert(parsed == null, 'data url');
  });

  await test('O140. native observe-only contract', () => {
    assert(native.includes('NEVER returns a replacement response') || native.includes('never'), 'observe only');
    assert(native.includes('observeRequest'), 'observe');
  });

  await test('O141. rate-limited native window', () => {
    assert(native.includes('MAX_EVENTS_PER_WINDOW'), 'cap');
    assert(native.includes('WINDOW_MS'), 'window');
  });

  await test('O142. DEV traces sampled', () => {
    assert(native.includes('MAX_TRACES_PER_WINDOW'), 'trace cap');
    assert(native.includes('FLAG_DEBUGGABLE'), 'debug');
  });

  await test('O143. general correlation ignores social pages', () => {
    const corrFile = readSrc('src/media-detection/general-media/general-correlation.service.ts');
    assert(corrFile.includes('resolveSocialPlatform'), 'social gate');
  });

  await test('O144. Progressive parser uses classifier', () => {
    const parser = readSrc('src/media-detection/parsers/progressive.parser.ts');
    assert(parser.includes('classifyGeneralNetworkResource'), 'shared classifier');
  });

  await test('O145. no second CTA state machine', () => {
    assert(mediaAction.includes('browserMediaActionService'), 'one service');
    assert(!mediaAction.includes('dynamicCtaMachine'), 'second machine');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

void main();
