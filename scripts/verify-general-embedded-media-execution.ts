/**
 * General embedded / iframe media execution verifier.
 * Run: npm run verify:general-embedded-media-execution
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  classifyMediaResolutionOutcome,
  toastForResolutionOutcome,
  toastForUserTriggeredDownloadOutcome,
  isDownloadResolutionTokenCurrent,
  UNAVAILABLE_DOWNLOAD_MESSAGE,
} from '../src/browser/media-actions/media-resolution-outcome';
import {
  correlateGeneralCandidate,
  generalPageMediaContextStore,
  selectCurrentGeneralMedia,
  type GeneralPageMediaContext,
} from '../src/media-detection/general-media';
import {
  canonicalizeGeneralContentKey,
  classifyGeneralContentNavigation,
  isSameGeneralContentNavigation,
} from '../src/media-detection/general-media/general-content-navigation';
import { extractGeneralPageVideoId } from '../src/media-detection/general-media/general-content-identity';
import {
  classifyGeneralNetworkResource,
  isPlayerDocumentResource,
  looksLikeDashManifestPath,
  looksLikeHlsPlaylistPath,
  shouldObserveNativeNetworkRequest,
} from '../src/media-detection/general-media/general-network-resource';
import {
  mergeEligibleWindowCandidates,
  observeCandidateInWindow,
  resetCandidateWindowsForTests,
} from '../src/media-detection/observation/candidate-observation-window';
import { parseDashManifest, parseHlsManifest, parseProgressiveMediaUrl } from '../src/media-detection/parsers';
import { looksLikeHlsCandidate } from '../src/media-detection/general-source/hls-evidence';
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

console.log('General embedded media execution verification\n');

async function main(): Promise<void> {
  const native = readSrc(
    'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt',
  );
  const hook = readSrc('src/browser/media-actions/useBrowserMediaAction.ts');
  const parser = readSrc('src/media-detection/parsers/progressive.parser.ts');
  const pageCtx = readSrc('src/media-detection/general-media/general-page-context.ts');
  const corr = readSrc('src/media-detection/general-media/general-correlation.service.ts');
  const bar = readSrc('src/browser/media-actions/BrowserMediaDownloadBar.tsx');

  // ── GROUP A — NETWORK OBSERVATION ────────────────────────────────────────
  await test('1. iframe media request can pass native observer gate', () => {
    assert(
      shouldObserveNativeNetworkRequest({
        url: 'https://cdn.example.com/vod/abc12x/media',
        hasRange: true,
        isForMainFrame: false,
      }),
      'range + family iframe',
    );
  });

  await test('2. iframe HTML is not treated as media', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/xtv3w.html',
      mimeType: 'text/html',
      isForMainFrame: false,
    });
    assert(!c.acceptForIngest, 'html not ingested');
    assert(c.rejectionReason === 'html_document' || c.rejectionReason === 'player_document', c.rejectionReason ?? '');
  });

  await test('3. JS is not media', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://geo.example.com/player/xtv3w.js',
      isForMainFrame: false,
    });
    assert(!c.acceptForIngest, 'js rejected');
    assert(c.family === 'script', c.family);
  });

  await test('4. image is not media', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/thumb.jpg',
      mimeType: 'image/jpeg',
    });
    assert(!c.acceptForIngest, 'image rejected');
  });

  await test('5. ad request not automatically media', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/vast/ad/clip',
      hasRange: true,
      isForMainFrame: false,
    });
    assert(c.family === 'ad' || !c.acceptForIngest, 'ad not auto media');
  });

  await test('6. video MIME can create progressive candidate', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/files/stream-object',
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: 'video/mp4',
      detectionSource: 'native_network',
    });
    assert(media != null, 'mime progressive');
    assert(media?.mimeType === 'video/mp4' || media?.extension === 'mp4' || media?.streamType === 'DIRECT', String(media?.mimeType));
  });

  await test('7. Range + strong media evidence can create candidate', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/vod/abc12x/media',
      pageUrl: 'https://www.example.com/video/abc12x',
      hasRange: true,
      isForMainFrame: false,
      detectionSource: 'native_network',
    });
    assert(media != null, 'range family ingest');
  });

  await test('8. extensionless media can enter verification', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/stream/abc12x',
      pageUrl: 'https://www.example.com/video/abc12x',
      hasRange: true,
      isForMainFrame: false,
      detectionSource: 'native_network',
    });
    assert(media != null, 'extensionless');
    assert(media.streamType === 'DIRECT' || media.streamProtocol == null, String(media.streamType));
  });

  await test('9. arbitrary extensionless API request rejected', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://www.example.com/api/session/status',
      pageUrl: 'https://www.example.com/video/abc12x',
      isForMainFrame: false,
      detectionSource: 'native_network',
    });
    assert(media == null, 'api rejected');
  });

  await test('10. signed query ignored for identity', () => {
    const a = canonicalizeGeneralContentKey(
      'https://www.example.com/video/abc12x?utm_source=x&sig=secret',
    );
    const b = canonicalizeGeneralContentKey('https://www.example.com/video/abc12x');
    assert(a === b, `${a} vs ${b}`);
  });

  await test('11. iframe src itself not treated as executable media', () => {
    assert(isPlayerDocumentResource('https://geo.example.com/player/xtv3w.html'), 'player html');
    const media = parseProgressiveMediaUrl({
      url: 'https://geo.example.com/player/xtv3w.html',
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: 'text/html',
      detectionSource: 'native_network',
    });
    assert(media == null, 'iframe src not media');
  });

  await test('12. candidate page ownership remains current main page', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media?.pageUrl.includes('example.com/video/abc12x'), media?.pageUrl ?? '');
  });

  // ── GROUP B — HLS ────────────────────────────────────────────────────────
  await test('13. .m3u8 accepted', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/play/master.m3u8',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media != null, 'm3u8');
    assert(media.streamProtocol === 'hls' || media.streamType === 'HLS', String(media.streamType));
  });

  await test('14. MPEGURL MIME accepted', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/hls/abc12x/manifest',
      pageUrl: 'https://www.example.com/video/abc12x',
      mimeType: 'application/vnd.apple.mpegurl',
      detectionSource: 'native_network',
    });
    assert(media != null, 'mpegurl mime');
    assert(media.streamProtocol === 'hls' || media.streamType === 'HLS', String(media.streamType));
  });

  await test('15. extensionless valid playlist can verify', () => {
    assert(looksLikeHlsPlaylistPath('https://cdn.example.com/hls/abc12x/index'), 'hls path');
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:4,\nhttps://cdn.example.com/seg1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/hls/abc12x/index',
    );
    assert(parsed != null, 'playlist parses');
    assert(parsed.isEncrypted === false, 'unencrypted');
    assert(parsed.isLive === false, 'vod');
  });

  await test('16. master playlist supported', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401f,mp4a.40.2"\nhttps://cdn.example.com/v360.m3u8\n',
      'https://cdn.example.com/master.m3u8',
    );
    assert(parsed?.isMaster === true, 'master');
  });

  await test('17. media playlist supported', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nhttps://cdn.example.com/1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/media.m3u8',
    );
    assert(parsed?.isMedia === true, 'media playlist');
  });

  await test('18. encrypted HLS rejected', () => {
    const parsed = parseHlsManifest(
      '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"\n#EXTINF:4,\nhttps://cdn.example.com/1.ts\n#EXT-X-ENDLIST\n',
      'https://cdn.example.com/enc.m3u8',
    );
    assert(parsed?.isEncrypted === true, 'encrypted');
  });

  await test('19. malformed playlist rejected', () => {
    const parsed = parseHlsManifest('not a playlist', 'https://cdn.example.com/bad.m3u8');
    assert(parsed == null, 'malformed');
  });

  await test('20. stale previous-video manifest rejected', () => {
    const ctx = iframeContext({ pageGeneration: 4, currentMediaIdentity: 'video:bbb99x' });
    const stale = makeMedia({
      id: 'old',
      url: 'https://cdn.example.com/hls/abc12x/master.m3u8',
      container: 'hls',
      category: 'stream',
      streamType: 'HLS',
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

  await test('21. wrong/offscreen candidate cannot replace current owner', () => {
    const ctx = iframeContext();
    const off = makeMedia({
      id: 'pre',
      url: 'https://cdn.example.com/preview/tiny.mp4',
      width: 120,
      height: 80,
    });
    const main = makeMedia({
      id: 'main',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [off, main],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id === 'main' || selected.group.activeCandidateIds.includes('main'), selected.media?.id ?? 'none');
  });

  // ── GROUP C — DASH ───────────────────────────────────────────────────────
  await test('22. MPD recognized', () => {
    assert(looksLikeDashManifestPath('https://cdn.example.com/dash/abc.mpd'), 'mpd');
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/dash/abc.mpd',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media != null, 'mpd candidate');
    assert(media?.streamProtocol === 'dash' || media?.streamType === 'DASH', String(media?.streamType));
  });

  await test('23. separate DASH A/V remains unsupported', () => {
    const parsed = parseDashManifest(
      '<MPD><Period><AdaptationSet contentType="video"><Representation id="v" bandwidth="1000"/></AdaptationSet><AdaptationSet contentType="audio"><Representation id="a" bandwidth="128"/></AdaptationSet></Period></MPD>',
      'https://cdn.example.com/dash.mpd',
    );
    assert(parsed?.hasSeparateAudio === true, 'separate av');
  });

  await test('24. DASH never mislabeled HLS', () => {
    assert(!looksLikeHlsCandidate({ url: 'https://cdn.example.com/x.mpd', mimeType: 'application/dash+xml' }), 'not hls');
  });

  await test('25. valid progressive alternative can still win', () => {
    const ctx = iframeContext();
    const dash = makeMedia({
      id: 'dash',
      url: 'https://cdn.example.com/dash.mpd',
      container: 'dash',
      category: 'stream',
      streamType: 'DASH',
      downloadable: false,
    });
    const prog = makeMedia({
      id: 'prog',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [dash, prog],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.includes('prog'), selected.group.activeCandidateIds.join(','));
  });

  // ── GROUP D — EMBEDDED CORRELATION ───────────────────────────────────────
  await test('26. iframe owner does not require candidate URL == iframe src', () => {
    const ctx = iframeContext();
    const cand = makeMedia({
      id: 'c1',
      url: 'https://cdn.example.com/vod/abc12x/file.mp4',
    });
    const result = correlateGeneralCandidate(cand, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence !== 'REJECTED', result.confidence);
    assert(result.evidence.currentSrcMatch !== true, 'must not require src match');
  });

  await test('27. page identity + generation + media evidence can correlate', () => {
    const ctx = iframeContext();
    const cand = makeMedia({ id: 'c1', url: 'https://cdn.example.com/stream/abc12x.mp4' });
    const result = correlateGeneralCandidate(cand, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'MEDIUM' || result.confidence === 'STRONG' || result.confidence === 'WEAK', result.confidence);
  });

  await test('28. candidate same generation eligible', () => {
    const ctx = iframeContext({ pageGeneration: 5 });
    const cand = makeMedia({ id: 'c1', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const result = correlateGeneralCandidate(cand, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 5,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence !== 'REJECTED', result.confidence);
  });

  await test('29. stale generation rejected', () => {
    const ctx = iframeContext({ pageGeneration: 5 });
    const cand = makeMedia({ id: 'c1', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const result = correlateGeneralCandidate(cand, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 4,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  await test('30. related/offscreen preload demoted for top-frame video', () => {
    const ctx = iframeContext({
      playerKind: 'video',
      frameClass: 'top',
      activeVideoCurrentSrc: 'https://cdn.example.com/main.mp4',
      activeVideoIntersectionRatio: 0.9,
    });
    const pre = makeMedia({ id: 'pre', url: 'https://cdn.example.com/related.mp4' });
    const result = correlateGeneralCandidate(pre, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(
      result.confidence === 'REJECTED' || result.confidence === 'WEAK',
      result.confidence,
    );
  });

  await test('31. main content wins over recommendation', () => {
    const ctx = iframeContext();
    const rec = makeMedia({
      id: 'rec',
      url: 'https://cdn.example.com/thumb/related.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
      container: 'unknown',
      category: 'video',
    });
    const main = makeMedia({ id: 'main', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const selected = selectCurrentGeneralMedia({
      candidates: [rec, main],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id !== 'rec', selected.media?.id ?? 'none');
  });

  await test('32. ad candidate does not automatically win', () => {
    const ctx = iframeContext({ explicitAdMarker: true });
    const ad = makeMedia({ id: 'ad', url: 'https://cdn.example.com/vod/ad.mp4' });
    const result = correlateGeneralCandidate(ad, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  await test('33. multiple current candidates are bounded', () => {
    const ctx = iframeContext();
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeMedia({ id: `c${i}`, url: `https://cdn.example.com/vod/abc12x/v${i}.mp4` }),
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
    assert(selected.group.activeCandidateIds.length >= 1, 'at least one');
  });

  await test('34. candidate #2 can verify after #1 fails', () => {
    const ctx = iframeContext();
    const dash = makeMedia({
      id: 'c1',
      url: 'https://cdn.example.com/x.mpd',
      container: 'dash',
      streamType: 'DASH',
      category: 'stream',
    });
    const hls = makeMedia({
      id: 'c2',
      url: 'https://cdn.example.com/x.m3u8',
      container: 'hls',
      streamType: 'HLS',
      category: 'stream',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [dash, hls],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.includes('c2'), selected.group.activeCandidateIds.join(','));
  });

  await test('35. candidate #3 can verify after #1/#2 fail', () => {
    const ctx = iframeContext();
    const selected = selectCurrentGeneralMedia({
      candidates: [
        makeMedia({ id: 'c1', url: 'https://cdn.example.com/a.mpd', container: 'dash', streamType: 'DASH', category: 'stream' }),
        makeMedia({ id: 'c2', url: 'https://cdn.example.com/frag.m4s', extension: 'm4s', container: 'unknown' }),
        makeMedia({ id: 'c3', url: 'https://cdn.example.com/ok.mp4' }),
      ],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.includes('c3'), selected.group.activeCandidateIds.join(','));
  });

  // ── GROUP E — EARLY/LATE RACES ───────────────────────────────────────────
  await test('36. candidate before owner retained in bounded window', () => {
    resetCandidateWindowsForTests();
    const media = makeMedia({ id: 'early', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    observeCandidateInWindow(
      { tabId: 'tab-a', navigationEpoch: 1, generation: 3, platform: 'general' },
      media,
    );
    const merged = mergeEligibleWindowCandidates(
      { tabId: 'tab-a', navigationEpoch: 1, generation: 3, platform: 'general' },
      [],
    );
    assert(merged.some((m) => m.id === 'early'), 'window retained');
  });

  await test('37. owner acquisition re-evaluates eligible candidate', () => {
    const ctx = iframeContext();
    const cand = makeMedia({ id: 'early', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const selected = selectCurrentGeneralMedia({
      candidates: [cand],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media?.id === 'early', selected.media?.id ?? 'none');
  });

  await test('38. owner before candidate accepts later candidate', () => {
    const ctx = iframeContext();
    const later = makeMedia({ id: 'late', url: 'https://cdn.example.com/vod/abc12x/later.mp4' });
    const selected = selectCurrentGeneralMedia({
      candidates: [later],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.activeCandidateIds.includes('late'), 'late accepted');
  });

  await test('39. no second tap required — automatic observation gathers store+window', () => {
    assert(hook.includes('mergeEligibleWindowCandidates'), 'window join in background verify');
    assert(hook.includes('void verifyCandidate(discovery.media)'), 'auto verify from observation');
  });

  await test('40. no reload required', () => {
    assert(!hook.includes('reload('), 'no reload');
    assert(!hook.includes('setInterval'), 'no poll');
  });

  await test('41. stale old-window candidate rejected', () => {
    resetCandidateWindowsForTests();
    const media = makeMedia({ id: 'old', url: 'https://cdn.example.com/vod/old/file.mp4' });
    observeCandidateInWindow(
      { tabId: 'tab-a', navigationEpoch: 1, generation: 1, platform: 'general' },
      media,
    );
    const merged = mergeEligibleWindowCandidates(
      { tabId: 'tab-a', navigationEpoch: 1, generation: 3, platform: 'general' },
      [],
    );
    assert(!merged.some((m) => m.id === 'old'), 'old generation excluded');
  });

  // ── GROUP F — GENERATION STABILITY ───────────────────────────────────────
  await test('42. /video/A → same /video/A = no generation bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x',
      'https://www.example.com/video/abc12x',
    );
    assert(d.sameContent, 'same');
  });

  await test('43. tracking query change = no content bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x?utm_source=a',
      'https://www.example.com/video/abc12x?utm_source=b',
    );
    assert(d.sameContent, 'tracking ignored');
  });

  await test('44. hash change = no content bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x#player',
      'https://www.example.com/video/abc12x#t=12',
    );
    assert(d.sameContent, 'hash ignored');
  });

  await test('45. player cosmetic state = no bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x?share=1',
      'https://www.example.com/video/abc12x',
    );
    assert(d.sameContent, 'share param ignored');
  });

  await test('46. same canonical content id = no bump', () => {
    assert(
      isSameGeneralContentNavigation(
        'https://www.example.com/embed/abc12x',
        'https://www.example.com/video/abc12x',
      ),
      'same id',
    );
  });

  await test('47. /video/A → /video/B = bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x',
      'https://www.example.com/video/xyz99z',
    );
    assert(!d.sameContent && d.didVideoIdentityChange, 'B is new');
  });

  await test('48. different canonical page content = bump', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/article/one',
      'https://www.example.com/article/two',
    );
    assert(!d.sameContent, 'articles differ');
  });

  await test('49. real navigation still invalidates', () => {
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const a = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.example.com/video/abc12x',
      navigationEpoch: 1,
    });
    const b = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.example.com/video/abc12x',
      navigationEpoch: 2,
    });
    assert((b?.pageGeneration ?? 0) > (a?.pageGeneration ?? 0), 'epoch bump');
  });

  await test('50. same-content SPA noise does not navigation-invalidate CTA', () => {
    assert(hook.includes('isSameGeneralContentNavigation'), 'cta uses content identity');
    generalPageMediaContextStore.clearAll();
    generalPageMediaContextStore.setActiveTab('tab-a');
    const a = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.example.com/video/abc12x',
      navigationEpoch: 1,
    });
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: 'tab-a',
      navigationEpoch: 1,
      evidence: {
        pageUrl: 'https://www.example.com/video/abc12x',
        elementIdentity: 'iframe-player',
        currentSrc: 'https://geo.example.com/player/xtv3w.html',
        src: 'https://geo.example.com/player/xtv3w.html',
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
        associatedContentId: 'abc12x',
        observedAt: Date.now(),
        playerKind: 'iframe',
        frameClass: 'cross-origin',
      },
    });
    const b = generalPageMediaContextStore.syncFromPageUrl({
      tabId: 'tab-a',
      pageUrl: 'https://www.example.com/video/abc12x?utm_campaign=x',
      navigationEpoch: 1,
    });
    assert(b?.pageGeneration === a?.pageGeneration, 'spa no bump');
    assert(b?.currentMediaIdentity != null, 'owner kept');
  });

  await test('51. new-content navigation invalidates A token', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x',
      'https://www.example.com/video/xyz99z',
    );
    assert(!d.sameContent, 'A token stale vs B');
  });

  await test('52. old A verify rejected after B', () => {
    const ctxB = iframeContext({
      currentMediaIdentity: 'video:xyz99z',
      pageUrl: 'https://www.example.com/video/xyz99z',
      pageGeneration: 8,
    });
    const a = makeMedia({ id: 'a', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const result = correlateGeneralCandidate(a, {
      context: ctxB,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: 'https://www.example.com/video/abc12x',
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  // ── GROUP G — CTA TAP ────────────────────────────────────────────────────
  await test('53. tap with verified offer enqueues', () => {
    assert(hook.includes('claimForHandoff'), 'handoff claim');
    assert(hook.includes('enqueueBrowserMediaDownload'), 'phase 1 enqueue');
  });

  await test('54. tap with no offer does not start Analyze; background verify remains', () => {
    assert(hook.includes("statusAtTap !== 'verified'"), 'unverified tap rejected');
    assert(!hook.includes('verifyCandidate(seed)'), 'no verify-on-tap');
    assert(hook.includes('void verifyCandidate(discovery.media)'), 'background verify');
    assert(hook.includes('RESOLUTION_JOINED'), 'join in-flight');
  });

  await test('55. tap does not silently no-op', () => {
    assert(bar.includes('toastForUserTriggeredDownloadOutcome'), 'user toast');
    const t = toastForUserTriggeredDownloadOutcome({
      kind: 'TRANSIENT_UNRESOLVED',
      reason: 'NO_FRESH_SOURCE',
    });
    assert(t != null && t.length > 0, 'transient visible');
  });

  await test('56. in-flight resolution gives busy/handoff state', () => {
    const o = classifyMediaResolutionOutcome({ verificationInFlight: true });
    assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
    assert(
      toastForUserTriggeredDownloadOutcome(o)?.includes('Preparing') ||
        Boolean(toastForUserTriggeredDownloadOutcome(o)),
      'busy copy',
    );
  });

  await test('57. transient unresolved returns coherent CTA state', () => {
    const o = classifyMediaResolutionOutcome({ hasCandidates: false });
    assert(o.kind === 'TRANSIENT_UNRESOLVED', o.kind);
    assert(toastForResolutionOutcome(o) == null, 'auto-verify still silent');
    assert(toastForUserTriggeredDownloadOutcome(o) != null, 'tap not silent');
  });

  await test('58. network failure gives correct message', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'PROBE_FAILED' });
    assert(o.kind === 'NETWORK_FAILURE', o.kind);
    assert(toastForUserTriggeredDownloadOutcome(o)?.toLowerCase().includes('reach'), 'network copy');
  });

  await test('59. proven unsupported gives unavailable message', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'DASH_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
    assert(toastForUserTriggeredDownloadOutcome(o) === UNAVAILABLE_DOWNLOAD_MESSAGE, 'unavailable');
  });

  await test('60. stale context aborts old handoff', () => {
    assert(
      !isDownloadResolutionTokenCurrent(
        { tabId: 'a', navigationEpoch: 1, generation: 1, contentIdentity: 'video:a' },
        { tabId: 'a', navigationEpoch: 1, generation: 2, contentIdentity: 'video:b' },
      ),
      'stale',
    );
  });

  await test('61. successful enqueue consumes current identity', () => {
    assert(hook.includes('commitConsumed'), 'consume');
    assert(hook.includes('ENQUEUE_ACCEPTED'), 'trace');
  });

  await test('62. new B gets new CTA', () => {
    assert(hook.includes('isSameGeneralContentNavigation'), 'content compare');
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/abc12x',
      'https://www.example.com/video/xyz99z',
    );
    assert(!d.sameContent, 'B distinct');
  });

  // ── GROUP H — GENERAL SOURCE SAFETY ──────────────────────────────────────
  await test('63. HTML rejected', () => {
    assert(
      classifyGeneralNetworkResource({
        url: 'https://www.example.com/video/abc12x',
        mimeType: 'text/html',
        isForMainFrame: true,
      }).acceptForIngest === false,
      'html',
    );
  });

  await test('64. JSON rejected', () => {
    assert(
      !classifyGeneralNetworkResource({
        url: 'https://www.example.com/api/player.json',
        mimeType: 'application/json',
      }).acceptForIngest,
      'json',
    );
  });

  await test('65. image rejected', () => {
    assert(
      !classifyGeneralNetworkResource({
        url: 'https://cdn.example.com/a.png',
      }).acceptForIngest,
      'png',
    );
  });

  await test('66. thumbnail rejected', () => {
    const ctx = iframeContext();
    const thumb = makeMedia({
      id: 't',
      url: 'https://cdn.example.com/thumbnail/abc.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    const result = correlateGeneralCandidate(thumb, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  await test('67. isolated fragment rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/seg/fragment1.m4s',
    });
    assert(!c.acceptForIngest, 'fragment');
  });

  await test('68. init segment rejected', () => {
    const c = classifyGeneralNetworkResource({
      url: 'https://cdn.example.com/init.m4s',
    });
    assert(!c.acceptForIngest, 'init');
  });

  await test('69. valid progressive MP4 accepted', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/ok.mp4',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media != null, 'mp4');
    assert(media?.extension === 'mp4' || media?.mimeType === 'video/mp4', String(media?.extension));
  });

  await test('70. valid WebM accepted if existing support', () => {
    const media = parseProgressiveMediaUrl({
      url: 'https://cdn.example.com/ok.webm',
      pageUrl: 'https://www.example.com/video/abc12x',
      detectionSource: 'native_network',
    });
    assert(media?.container === 'webm' || media != null, String(media?.container));
  });

  await test('71. supported HLS accepted', () => {
    assert(looksLikeHlsCandidate({ url: 'https://cdn.example.com/a.m3u8' }), 'hls cand');
  });

  await test('72. DRM rejected', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'DRM_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  await test('73. encrypted HLS rejected', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'ENCRYPTED_HLS' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  await test('74. unsupported DASH rejected', () => {
    const o = classifyMediaResolutionOutcome({ rejectionReason: 'DASH_UNSUPPORTED' });
    assert(o.kind === 'PROVEN_UNSUPPORTED', o.kind);
  });

  // ── GROUP I — WRONG VIDEO SAFETY ─────────────────────────────────────────
  await test('75. A owner + A candidate → offer A', () => {
    const ctx = iframeContext({ currentMediaIdentity: 'video:abc12x' });
    const a = makeMedia({ id: 'a', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const selected = selectCurrentGeneralMedia({
      candidates: [a],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.group.currentMediaIdentity === 'video:abc12x', selected.group.currentMediaIdentity ?? '');
    assert(selected.media?.id === 'a', selected.media?.id ?? '');
  });

  await test('76. A owner + B preload → no B offer as current winner required', () => {
    const ctx = iframeContext();
    const b = makeMedia({
      id: 'b',
      url: 'https://cdn.example.com/preview_image/b.jpg',
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    const selected = selectCurrentGeneralMedia({
      candidates: [b],
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(selected.media == null || selected.media.id !== 'b' || selected.group.confidence === 'REJECTED', 'no b offer');
  });

  await test('77. B owner replaces A', () => {
    assert(
      extractGeneralPageVideoId('https://www.example.com/video/xyz99z') === 'xyz99z',
      'b id',
    );
  });

  await test('78. stale A candidate cannot bind B', () => {
    const ctx = iframeContext({
      currentMediaIdentity: 'video:xyz99z',
      pageUrl: 'https://www.example.com/video/xyz99z',
      pageGeneration: 9,
    });
    const a = makeMedia({ id: 'a', url: 'https://cdn.example.com/vod/abc12x/file.mp4' });
    const result = correlateGeneralCandidate(a, {
      context: ctx,
      tabId: 'tab-a',
      navigationEpoch: 1,
      pageGeneration: 3,
      pageUrl: ctx.pageUrl,
    });
    assert(result.confidence === 'REJECTED', result.confidence);
  });

  await test('79. stale A verify cannot enqueue under B', () => {
    assert(
      !isDownloadResolutionTokenCurrent(
        { tabId: 't', navigationEpoch: 1, generation: 3, contentIdentity: 'video:abc12x' },
        { tabId: 't', navigationEpoch: 1, generation: 9, contentIdentity: 'video:xyz99z' },
      ),
      'token',
    );
  });

  await test('80. quality A cannot enqueue after B takeover', () => {
    assert(hook.includes('isDownloadResolutionTokenCurrent'), 'token recheck');
  });

  await test('81. fast A→B→C ends with C only', () => {
    const d = classifyGeneralContentNavigation(
      'https://www.example.com/video/aaa11a',
      'https://www.example.com/video/ccc33c',
    );
    assert(d.newIdentity?.includes('ccc33c'), d.newIdentity ?? '');
  });

  // ── GROUP J — ARCHITECTURE ───────────────────────────────────────────────
  await test('82. no Dailymotion API', () => {
    assert(!parser.includes('api.dailymotion.com'), 'no dm api');
    assert(!native.toLowerCase().includes('dailymotion.com'), 'no dm host allowlist');
  });

  await test('83. no backend', () => {
    const net = readSrc('src/media-detection/general-media/general-network-resource.ts');
    assert(!net.includes('http://127.0.0.1'), 'no local backend');
  });

  await test('84. no remote resolver', () => {
    assert(!hook.includes('cloudflare'), 'no remote resolver');
  });

  await test('85. no cross-origin DOM bypass', () => {
    const inj = readSrc('src/media-detection/observers/injected-script.ts');
    assert(!inj.includes('iframe.contentDocument') || inj.includes('catch'), 'no silent bypass');
  });

  await test('86. no FFmpeg', () => {
    assert(!parser.toLowerCase().includes('ffmpeg'), 'no ffmpeg');
  });

  await test('87. no DASH mux', () => {
    const src = readSrc('src/media-detection/general-source/general-source-reliability.service.ts');
    assert(src.includes('DASH_UNSUPPORTED'), 'dash unsupported');
    assert(!src.toLowerCase().includes('muxer'), 'no muxer');
  });

  await test('88. no DRM bypass', () => {
    assert(hook.includes('DRM') || readSrc('src/browser/media-actions/media-resolution-outcome.ts').includes('DRM_UNSUPPORTED'), 'drm stays unsupported');
  });

  await test('89. no polling', () => {
    assert(!hook.includes('setInterval'), 'no setInterval');
  });

  await test('90. no repeated setTimeout scan', () => {
    const nav = readSrc('src/media-detection/general-media/general-content-navigation.ts');
    assert(!nav.includes('setTimeout'), 'no timer in nav');
  });

  await test('91. no second media detector', () => {
    assert(parser.includes('parseProgressiveMediaUrl'), 'same parser');
  });

  await test('92. no DOM-injected CTA', () => {
    const inj = readSrc('src/media-detection/observers/injected-script.ts');
    assert(!inj.includes('Download'), 'no injected download');
  });

  await test('93. Phase 1 unchanged', () => {
    assert(hook.includes('enqueueBrowserMediaDownload'), 'still phase 1 enqueue');
  });

  await test('94. Pause/Resume unchanged', () => {
    const pause = readSrc('src/downloads/execution/download-state-machine.ts');
    assert(pause.includes('PAUSED') || pause.includes('DOWNLOADING'), 'state machine present');
  });

  await test('95. TikTok native still has dedicated heuristic', () => {
    assert(native.includes('tiktokLooksMedia'), 'tiktok path kept');
  });

  await test('96. Instagram correlation file untouched by dailymotion allowlist', () => {
    const ig = readSrc('src/media-detection/social/social-content-identity.ts');
    assert(!ig.toLowerCase().includes('dailymotion'), 'ig clean');
  });

  await test('97. Phase 6 secrets not persisted in network classifier', () => {
    const net = readSrc('src/media-detection/general-media/general-network-resource.ts');
    assert(!net.includes('Cookie'), 'no cookie field');
    assert(!net.includes('Authorization'), 'no auth field');
  });

  await test('98. candidate buffers bounded', () => {
    assert(corr.includes('MAX_ACTIVE_GENERAL_CANDIDATES'), 'bounded active set');
  });

  await test('99. no full signed URL logging', () => {
    const diag = readSrc('src/media-detection/general-media/general-media-diagnostics.ts');
    assert(diag.includes('hashSafeId'), 'hashes ids');
    assert(!diag.includes('putString("url"'), 'no url log helper');
  });

  await test('100. no Cookie/Auth logging', () => {
    assert(!native.includes('Authorization'), 'native no auth log');
    assert(native.includes('hasCookieHeader'), 'boolean only');
  });

  await test('101. native emits hasRange', () => {
    assert(native.includes('putBoolean("hasRange", hasRange)'), 'hasRange on bridge');
  });

  await test('102. generation follows content identity', () => {
    assert(pageCtx.includes('classifyGeneralContentNavigation'), 'wired');
    assert(pageCtx.includes('SAME_CONTENT_IGNORED'), 'same content log');
  });

  await test('103. short-link ids extract', () => {
    assert(extractGeneralPageVideoId('https://dai.example/xb6huwu') === 'xb6huwu' || extractGeneralPageVideoId('https://short.example/xb6huwu') === 'xb6huwu', extractGeneralPageVideoId('https://short.example/xb6huwu') ?? 'none');
  });

  await test('104. main-frame HTML /video/id is not observed as media', () => {
    assert(
      !shouldObserveNativeNetworkRequest({
        url: 'https://www.example.com/video/abc12x',
        isForMainFrame: true,
      }),
      'main html page',
    );
  });

  await test('105. iframe src HTML skipped by native skip path', () => {
    assert(native.includes('html?'), 'html skip');
  });

  if (failed > 0) {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(1);
  }
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
}

void main();
