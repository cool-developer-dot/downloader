/** Deterministic production-function + integration-contract checks. No device/build/network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { VIDEO_FORMATS, normalizeVideoMime, resolveVideoFormatHint, resolveVideoResource, videoFormatFromUrl, prefersExternalVideoPlayback } from '../src/media-detection/resource/video-resource';
import { sniffMediaSignature } from '../src/downloads/engine/media-signature';
import { parseHlsPlaylist } from '../src/downloads/engine/hls/playlist';
import { parseHlsManifest } from '../src/media-detection/parsers/hls.parser';
import { parseDashManifest, selectDownloadableStandaloneDash } from '../src/media-detection/parsers/dash.parser';
import { parseProgressiveMediaUrl } from '../src/media-detection/parsers/progressive.parser';
import { extractFromDomCandidate } from '../src/media-detection/extractors/dom.extractor';
import { extractDetectedMedia } from '../src/media-detection/extractors/metadata.extractor';
import { buildMediaDetectionBeforeContentScript, buildMediaDetectionInjectedScript } from '../src/media-detection/observers';
import { registerNativeObservationScope, resolveNativeObservationScope } from '../src/media-detection/adapters/native-observation-scope';
import { processNativeMediaCandidateEvent, resetNativeNetworkContractForTests } from '../src/media-detection/adapters/native-network.contract';
import { classifyGeneralNetworkResource, correlateGeneralCandidate } from '../src/media-detection/general-media';
import { classifyGeneralContentNavigation } from '../src/media-detection/general-media/general-content-navigation';
import { dedupeUpsert } from '../src/media-detection/services/deduplication.service';
import { stableResourcePath, sameResourceFamily } from '../src/media-detection/social-source/resource-identity';
import { resolveQualityLabelFromEvidence } from '../src/media-detection/social-source/quality-evidence';
import { buildVerificationCacheKey, getCachedVerifiedVariant, setCachedVerifiedVariant, joinOrStartVerification, clearAllVerificationSessions } from '../src/media-detection/social-source/verification-session';
import { resolveCompletedContainer, resolveCompletedMimeType } from '../src/downloads/completed-file/extension';
import { resolveCompletedDescriptor } from '../src/downloads/completed-file/descriptor';
import * as quality from '../src/downloads/quality';
import { emptyAnalysis, createVariant } from '../src/downloads/analyze/format';
import { selectVerifiedStandaloneQualities, hasMultipleVerifiedQualities } from '../src/browser/media-actions/verified-quality-options';
import { buildBrowserMediaFingerprint } from '../src/browser/media-actions/media-fingerprint';
import { resolveDownloadRuntimeActions } from '../src/downloads/runtime-actions';
import { validateRangeResumeResponse } from '../src/downloads/engine/range-validation';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
(globalThis as typeof globalThis & { __DEV__: boolean }).__DEV__ = false;
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
let passed = 0, failed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
function contract(name: string, path: string, ...needles: string[]) {
  return test(name, () => { const source = read(path); for (const needle of needles) assert(source.includes(needle), `${path}: ${needle}`); });
}
function box(type: string, length = 0, text = '') {
  const bytes = new Uint8Array(8 + length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(Buffer.from(type), 4); bytes.set(Buffer.from(text), 8); return bytes;
}
function concat(...parts: Uint8Array[]) { return new Uint8Array(Buffer.concat(parts)); }
const mp4 = concat(box('ftyp', 16, 'isom'), box('moov', 8), box('mdat', 20_000));
const mov = concat(box('ftyp', 16, 'qt  '), box('moov', 8), box('mdat', 20_000));
const legacyMov = concat(box('moov', 8), box('mdat', 20_000));
const fmp4 = concat(box('ftyp', 16, 'isom'), box('moov', 8, '\u0000\u0000\u0000\bmvex'), box('moof', 8), box('mdat', 20_000));
const webm = new Uint8Array(20_000); webm.set([0x1a, 0x45, 0xdf, 0xa3]);
const avi = new Uint8Array(20_000); avi.set(Buffer.from('RIFF')); new DataView(avi.buffer).setUint32(4, avi.length - 8, true); avi.set(Buffer.from('AVI '), 8);
const wmv = new Uint8Array(20_000);
wmv.set([0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c]);
wmv.set([0xc0,0xef,0x19,0xbc,0x4d,0x5b,0xcf,0x11,0xa8,0xfd,0x00,0x80,0x5f,0x5c,0x44,0x2b], 54);
const PAGE = 'https://news.example/watch/abc123';
const URL = 'https://cdn.example/object?id=film&quality=720';
const ctx = { pageUrl: PAGE, referer: PAGE, userAgent: 'fixture-UA', cookiesRequired: false, capturedAt: Date.now(), headers: { Referer: PAGE, 'User-Agent': 'fixture-UA' } };
function media(overrides: any = {}) {
  const base = extractDetectedMedia(parseProgressiveMediaUrl({ url: URL, pageUrl: PAGE, mimeType: 'video/mp4', detectionSource: 'native_network' })!);
  return { ...base!, width: 1280, height: 720, observedTabId: 'a', observedNavigationEpoch: 1, observedPageGeneration: 1, ...overrides };
}
const owner: any = {
  tabId: 'a', navigationEpoch: 1, pageGeneration: 1, pageUrl: PAGE,
  activeMediaElementIdentity: 'video:0', activeMediaResourceIdentity: stableResourcePath(URL), currentMediaIdentity: 'video:abc123',
  activeVideoCurrentSrc: URL, activeVideoIsBlob: false, activeVideoIntersectionRatio: 0.9,
  activeVideoPaused: false, activeVideoRecentlyPlayed: true, activeVideoMuted: false,
  activeVideoWidth: 1280, activeVideoHeight: 720, explicitAdMarker: false, userInteractionSignal: true,
  playerKind: 'video', frameClass: 'top', iframeIdentity: null, ownerStrength: 'STRONG', observedAt: Date.now(),
};
function correlate(candidate: any, context = owner) {
  return correlateGeneralCandidate(candidate, { context, tabId: 'a', navigationEpoch: 1, pageGeneration: 1, pageUrl: PAGE });
}
const vod = '#EXTM3U\n#EXT-X-TARGETDURATION:5\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:5,\npart1.ts\n#EXT-X-ENDLIST';
const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1.4d401f,mp4a.40.2"\n1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"\n720/index.m3u8';

// Load the actual TS module while replacing native/network boundaries. No source
// rewriting, extracted function copies, real filesystem mutation, or live HTTP.
function isolate(path: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): any {
  const filename = resolve(ROOT, path), req = createRequire(filename);
  const exports = {};
  const code = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports };
  runInNewContext(code, {
    module, exports, require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : req(id.startsWith('@/') ? resolve(ROOT, 'src', id.slice(2)) : id),
    console, Uint8Array, DataView, Buffer, URL: globalThis.URL, URLSearchParams, AbortController, setTimeout, clearTimeout, fetch: globalThis.fetch, ...globals,
  }, { filename });
  return module.exports;
}

async function main() {
  for (const [format, bytes] of Object.entries({ mp4, m4v: mp4, mov, webm, avi, wmv })) {
    await test(`format ${format}: MIME + structure + completed identity`, () => {
      const mime = VIDEO_FORMATS[format as keyof typeof VIDEO_FORMATS].mime;
      const result = resolveVideoResource({ url: `https://cdn.example/movie.${format}`, mimeType: `${mime}; charset=binary`, bytes, totalBytes: bytes.length });
      assert.equal(result.state, 'VERIFIED'); assert.equal(result.format, format);
      const evidence = { signatureKind: sniffMediaSignature(bytes, { requireStandaloneMp4: true }).kind, verifiedMimeType: mime, containerHint: format };
      const container = resolveCompletedContainer(evidence, `movie.${format}`);
      assert.equal(container, format); assert.equal(resolveCompletedMimeType(evidence, `movie.${format}`), mime);
    });
  }
  await test('extension-only is a candidate, never verified', () => { assert.equal(videoFormatFromUrl('https://cdn.example/m.mp4'), 'mp4'); assert.equal(resolveVideoResource({ url: 'https://cdn.example/m.mp4' }).state, 'TRANSIENT_UNRESOLVED'); });
  await test('extensionless MP4 proven by bytes with no MIME', () => assert.equal(resolveVideoResource({ url: URL, bytes: mp4 }).format, 'mp4'));
  await test('octet-stream + bytes verifies extensionless MP4', () => assert.equal(resolveVideoResource({ url: URL, mimeType: 'application/octet-stream', bytes: mp4 }).state, 'VERIFIED'));
  await test('MIME parameters normalized', () => assert.equal(normalizeVideoMime(' Video/MP4 ; charset=x'), 'video/mp4'));
  await test('extensionless endpoint named mp4 is not a suffix', () => assert.equal(videoFormatFromUrl('https://cdn.example/mp4'), null));
  await test('Content-Disposition preserves M4V identity', () => assert.equal(resolveVideoFormatHint({ mimeType: 'video/mp4', contentDisposition: 'attachment; filename="film.m4v"' }), 'm4v'));
  await test('redirect MIME is authoritative over stale suffix', () => assert.equal(resolveVideoResource({ url: 'https://cdn.example/a.mp4', finalUrl: 'https://cdn.example/object', mimeType: 'video/webm', bytes: webm }).format, 'webm'));
  await test('contradictory concrete MIME rejected', () => assert.equal(resolveVideoResource({ url: URL, mimeType: 'video/webm', bytes: mp4 }).state, 'PROVEN_UNSUPPORTED'));
  for (const [mimeType, body] of [['text/html', '<html>login page</html>'], ['application/json', '{"error":"denied"}']]) {
    await test(`${mimeType} response rejected even on .mp4`, () => assert.equal(resolveVideoResource({ url: 'https://cdn.example/f.mp4', mimeType, bytes: Buffer.from(body) }).state, 'PROVEN_UNSUPPORTED'));
  }
  await test('unknown video MIME never defaults to MP4', () => assert.equal(resolveVideoFormatHint({ mimeType: 'video/unknown' }), null));
  await test('legacy QuickTime moov+mdat accepted', () => assert.equal(resolveVideoResource({ url: URL, bytes: legacyMov }).format, 'mov'));
  await test('standalone fMP4 has initialization and media', () => assert.equal(resolveVideoResource({ url: URL, bytes: fmp4 }).standaloneFragmented, true));
  for (const [label, bytes] of [['init', concat(box('ftyp', 16, 'isom'), box('moov', 8))], ['fragment', concat(box('moof', 8), box('mdat', 24))], ['fragment-with-ftyp', concat(box('ftyp', 16, 'isom'), box('moof', 8), box('mdat', 24))]] as const) {
    await test(`${label} is not standalone`, () => assert.equal(resolveVideoResource({ url: URL, bytes, totalBytes: bytes.length }).state, 'PROVEN_UNSUPPORTED'));
  }
  await test('partial moov is unresolved even with large claimed size', () => assert.equal(resolveVideoResource({ url: URL, bytes: concat(box('ftyp', 16, 'isom'), box('moov', 8)), totalBytes: 10_000_000 }).state, 'TRANSIENT_UNRESOLVED'));
  await test('MP4 box extending past full length rejected', () => assert.equal(resolveVideoResource({ url: URL, bytes: mp4, totalBytes: 40 }).state, 'PROVEN_UNSUPPORTED'));
  await test('DRM flag excludes bytes', () => assert.equal(resolveVideoResource({ url: URL, bytes: mp4, isDrm: true }).state, 'PROVEN_UNSUPPORTED'));
  await test('protected sample entry excludes encrypted MP4', () => { const bytes = concat(box('ftyp', 16, 'isom'), box('moov', 16, '\u0000\u0000\u0000\bencv'), box('mdat', 20_000)); assert.equal(resolveVideoResource({ url: URL, bytes }).reason, 'drm_protected'); });
  await test('audio-only ASF is unresolved video', () => assert.equal(resolveVideoResource({ url: URL, bytes: wmv.slice(0, 40) }).state, 'TRANSIENT_UNRESOLVED'));
  await test('RIFF WAV cannot masquerade as AVI', () => { const bytes = avi.slice(); bytes.set(Buffer.from('WAVE'), 8); assert.notEqual(resolveVideoResource({ url: URL, bytes }).state, 'VERIFIED'); });
  await test('AVI/WMV external preference distinct from download support', () => { assert(prefersExternalVideoPlayback({ fileName: 'a.avi' })); assert(prefersExternalVideoPlayback({ mimeType: 'video/x-ms-wmv' })); assert(!prefersExternalVideoPlayback({ fileName: 'a.mp4' })); });

  const injected = buildMediaDetectionInjectedScript();
  await test('injected main observer is executable JavaScript', () => { new Function(injected); });
  await test('before-content observer is executable JavaScript', () => { new Function(buildMediaDetectionBeforeContentScript()); });
  for (const [label, token] of [['currentSrc', 'currentSrc'], ['source children', 'source'], ['dynamic mutation', 'MutationObserver'], ['fetch', '_fetch.apply'], ['XHR', 'XMLHttpRequest.prototype.send'], ['performance', 'PerformanceObserver'], ['early resource replay', "getEntriesByType('resource')"], ['DRM event', "addEventListener('encrypted'"], ['cleanup', "removeEventListener('encrypted'"]]) {
    await test(`observer ${label}`, () => assert(injected.includes(token)));
  }
  await test('extensionless DOM source survives both normalization stages', () => { const candidate = extractFromDomCandidate({ url: URL, pageUrl: PAGE, tagName: 'video', detectionSource: 'dom_video', ownerElementIdentity: 'video:0', frameUrl: PAGE } as any); assert(candidate); assert.equal(extractDetectedMedia(candidate)?.category, 'video'); });
  await test('no YouTube-specific extractor', () => assert(!/ytInitialPlayerResponse|signatureCipher|youtubei\/v1/.test(injected)));
  for (const isForMainFrame of [true, false]) {
    await test(`native ${isForMainFrame ? 'main' : 'child'} frame reaches scoped ingress`, () => {
      const cleanup = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 1, pageUrl: PAGE, active: true });
      resetNativeNetworkContractForTests();
      const candidate = processNativeMediaCandidateEvent({ url: URL, mimeHint: 'video/mp4', method: 'GET', parentViewId: 100, observedAt: Date.now() + 1, isForMainFrame, requestReferer: PAGE });
      assert.equal(candidate?.tabId, 'a'); assert.equal(candidate?.navigationEpoch, 1); cleanup();
    });
  }
  await test('unowned service-worker event is not attributed to active tab', () => assert.equal(resolveNativeObservationScope({ observationSource: 'service-worker', observedAt: Date.now() }), null));
  await test('service-worker requires unique document ownership', () => {
    const a = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 1, pageUrl: PAGE, active: true });
    const event = { observationSource: 'service-worker', requestReferer: PAGE, observedAt: Date.now() + 1 };
    assert.equal(resolveNativeObservationScope(event)?.tabId, 'a');
    const b = registerNativeObservationScope(101, { tabId: 'b', navigationEpoch: 1, pageUrl: PAGE, active: false });
    assert.equal(resolveNativeObservationScope(event), null); b(); a();
  });
  await test('inactive and pre-navigation native events rejected', () => {
    const a = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 2, pageUrl: PAGE, active: true });
    assert.equal(resolveNativeObservationScope({ parentViewId: 100, observedAt: 0 }), null);
    const b = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 2, pageUrl: PAGE, active: false }); a();
    assert.equal(resolveNativeObservationScope({ parentViewId: 100, observedAt: Date.now() + 1 }), null); b();
  });
  await test('scope update survives prior registration cleanup', () => {
    const a = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 1, pageUrl: PAGE, active: true });
    const b = registerNativeObservationScope(100, { tabId: 'a', navigationEpoch: 1, pageUrl: PAGE, active: true }); a();
    assert.equal(resolveNativeObservationScope({ parentViewId: 100, observedAt: Date.now() + 1 })?.tabId, 'a'); b();
  });
  await test('extensionless child Range accepted internally', () => assert(classifyGeneralNetworkResource({ url: URL, hasRange: true, isForMainFrame: false }).acceptForIngest));
  await test('arbitrary extensionless app-shell rejected', () => assert(!classifyGeneralNetworkResource({ url: 'https://cdn.example/app-shell', isForMainFrame: true }).acceptForIngest));

  await test('current visible content accepted', () => assert.equal(correlate(media()).confidence, 'STRONG'));
  for (const [label, changes] of [['old tab', { observedTabId: 'b' }], ['old epoch', { observedNavigationEpoch: 0 }], ['old generation', { observedPageGeneration: 0 }], ['old page', { pageUrl: 'https://news.example/watch/other1' }]]) {
    await test(`correlation rejects ${label}`, () => assert.equal(correlate(media(changes)).confidence, 'REJECTED'));
  }
  await test('same-content SPA tracking churn survives', () => assert(classifyGeneralContentNavigation(PAGE, PAGE + '?utm_source=x#controls').sameContent));
  await test('SPA content ID change invalidates', () => assert(!classifyGeneralContentNavigation(PAGE, PAGE.replace('abc123', 'def456')).sameContent));
  await test('same ID on unrelated host is different content', () => assert(!classifyGeneralContentNavigation(PAGE, PAGE.replace('news.example', 'other.example')).sameContent));
  await test('cross-origin iframe request retains frame ownership', () => { const frame = 'https://player.example/embed/abc123'; const c = { ...owner, playerKind: 'iframe', activeVideoCurrentSrc: frame, frameClass: 'cross-origin' }; assert.notEqual(correlate(media({ frameUrl: frame }), c).confidence, 'REJECTED'); assert.equal(correlate(media({ frameUrl: PAGE }), c).confidence, 'REJECTED'); });
  await test('unrelated background resource rejected', () => assert.equal(correlate(media({ url: 'https://cdn.example/unrelated.mp4', finalUrl: 'https://cdn.example/unrelated.mp4', sourceUrl: 'https://cdn.example/unrelated.mp4' })).confidence, 'REJECTED'));
  await test('explicit ad owner rejected', () => assert.equal(correlate(media(), { ...owner, explicitAdMarker: true }).confidence, 'REJECTED'));
  await test('DOM alternatives retain shared owner', () => assert.equal(correlate(media({ url: 'https://cdn.example/alt.webm', finalUrl: 'https://cdn.example/alt.webm', sourceUrl: 'https://cdn.example/alt.webm', ownerElementIdentity: 'video:0' })).confidence, 'STRONG'));
  await test('blob-only cannot be verified', () => assert.notEqual(resolveVideoResource({ url: 'blob:https://news.example/abc' }).state, 'VERIFIED'));
  await test('DOM + native duplicate collapsed', () => assert.equal(dedupeUpsert([media()], media({ id: 'native-copy' }), 20).items.length, 1));
  await test('candidate storage bounded', () => { let items: any[] = []; for (let i = 0; i < 400; i++) items = dedupeUpsert(items, media({ id: String(i), url: `${URL}&id2=${i}`, finalUrl: null, sourceUrl: null }), 20).items; assert.equal(items.length, 20); });
  await test('signed refresh same owned resource', () => assert(sameResourceFamily(URL + '&token=old', URL + '&token=new')));
  await test('content/quality query selectors distinguish resources', () => { assert(!sameResourceFamily(URL, URL.replace('720', '1080'))); assert(!sameResourceFamily(URL, URL.replace('film', 'other'))); });
  await test('case-sensitive resource paths remain distinct', () => assert(!sameResourceFamily('https://cdn.example/Abc', 'https://cdn.example/abc')));
  await test('CTA fingerprints retain query variant identity', () => assert.notEqual(buildBrowserMediaFingerprint({ pageUrl: PAGE, mediaUrl: URL }), buildBrowserMediaFingerprint({ pageUrl: PAGE, mediaUrl: URL.replace('720', '1080') })));

  const variants = [
    createVariant({ sourceUrl: URL, streamType: 'PROGRESSIVE', container: 'mp4', mimeType: 'video/mp4', width: 1280, height: 720, bitrate: 1_000_000, downloadable: true }),
    createVariant({ sourceUrl: URL.replace('720', '1080'), streamType: 'PROGRESSIVE', container: 'webm', mimeType: 'video/webm', width: 1920, height: 1080, bitrate: 3_000_000, downloadable: true }),
  ];
  const analysis = { ...emptyAnalysis(URL), finalUrl: URL, downloadable: true, mediaType: 'video' as const, container: 'mp4' as const, variants };
  const options = quality.normalizeAnalysisToSelection(analysis).options;
  await test('one verified source bypasses quality sheet', () => assert(!hasMultipleVerifiedQualities([options[0]])));
  await test('multiple verified formats produce quality choices', () => assert(hasMultipleVerifiedQualities(options)));
  await test('resolution ordering is numeric', () => assert.equal(options[0].height, 1080));
  await test('bitrate fallback orders unknown resolutions', () => { const ranked = quality.sortQualityOptions(options.map((o, i) => ({ ...o, width: null, height: null, bitrate: i ? 9_000_000 : 1_000_000 }))); assert.equal(ranked[0].bitrate, 9_000_000); });
  await test('unknown resolution is not guessed from labels', () => { assert.equal(resolveQualityLabelFromEvidence({ resolution: '1080p' }), null); assert.equal(quality.buildQualityLabel({}), 'Original Quality'); });
  await test('quality container label retained', () => assert(quality.buildQualityMetaLine(options[0]).toLowerCase().includes('webm')));
  await test('credential-only duplicate quality removed', () => assert.equal(selectVerifiedStandaloneQualities([options[0], { ...options[0], id: 'dup', sourceUrl: options[0].sourceUrl + '&token=x' }]).length, 1));
  await test('same-height query-selected resources not collapsed', () => assert.equal(selectVerifiedStandaloneQualities([options[0], { ...options[0], id: 'alt', sourceUrl: options[0].sourceUrl + '&codec=other' }]).length, 2));
  await test('selected option maps exactly to payload', () => { const selected = quality.findQualityOptionById(options, options[1].id)!; assert.equal(quality.toCreateDownloadInput(quality.normalizeAnalysisToSelection(analysis), selected)?.sourceUrl, URL); });
  await test('unverified quality cannot be selected', () => assert.equal(selectVerifiedStandaloneQualities([{ ...options[0], downloadable: false }]).length, 0));

  for (const mime of ['application/vnd.apple.mpegurl', 'application/x-mpegURL', 'audio/mpegurl']) await test(`HLS MIME ${mime}`, () => assert.equal(resolveVideoFormatHint({ mimeType: mime }), 'hls'));
  await test('HLS suffix is a manifest requiring verification', () => assert.equal(resolveVideoResource({ url: 'https://cdn.example/a.m3u8' }).reason, 'MANIFEST_VERIFICATION_REQUIRED'));
  await test('unencrypted VOD uses production downloader parser', () => assert.equal(parseHlsPlaylist(vod, 'https://cdn.example/a.m3u8').kind, 'media'));
  await test('HLS master retains relative variants and resolution', () => { const parsed = parseHlsManifest(master, 'https://cdn.example/master.m3u8')!; assert.equal(parsed.variants.length, 2); assert.equal(parsed.variants[0].uri, 'https://cdn.example/1080/index.m3u8'); assert.equal(parsed.variants[0].height, 1080); });
  for (const method of ['AES-128', 'SAMPLE-AES']) await test(`encrypted HLS ${method} rejected`, () => assert.throws(() => parseHlsPlaylist(vod.replace('#EXTINF', `#EXT-X-KEY:METHOD=${method},URI="key"\n#EXTINF`), URL)));
  await test('live HLS rejected', () => assert.throws(() => parseHlsPlaylist(vod.replace('#EXT-X-ENDLIST', '').replace('#EXT-X-PLAYLIST-TYPE:VOD', ''), URL)));
  await test('HLS fMP4 MAP remains accepted', () => assert.equal(parseHlsPlaylist(vod.replace('#EXTINF', '#EXT-X-MAP:URI="init.mp4"\n#EXTINF').replace('part1.ts', 'part1.m4s'), URL).kind, 'media'));
  await test('segment never offered independently', () => assert(!classifyGeneralNetworkResource({ url: 'https://cdn.example/seg-123.ts' }).acceptForIngest));
  await test('mux-required DASH remains excluded', () => { const xml = '<MPD><Period><AdaptationSet mimeType="video/mp4"><Representation id="v"><SegmentTemplate media="a.m4s"/></Representation></AdaptationSet></Period></MPD>'; const parsed = parseDashManifest(xml, URL)!; assert.equal(selectDownloadableStandaloneDash(parsed, xml).length, 0); });

  await test('verification cache includes current signed executable URL', () => { const base = { tabId: 'a', navigationEpoch: 1, contextGeneration: 1, contentIdentity: 'film' }; assert.notEqual(buildVerificationCacheKey({ ...base, executableUrl: URL + '&token=a' }), buildVerificationCacheKey({ ...base, executableUrl: URL + '&token=b' })); });
  await test('verification is coalesced and starts after registration', async () => { clearAllVerificationSessions(); let calls = 0; const start = async () => { calls++; return null; }; const a = joinOrStartVerification('same', start), b = joinOrStartVerification('same', start); assert(b.joined); assert.equal(a.promise, b.promise); await a.promise; assert.equal(calls, 1); });
  await test('HLS cache retains alternatives without session secrets', () => { const v: any = { verifiedAt: Date.now(), requestContext: { ...ctx, headers: { Cookie: 'secret', Authorization: 'secret', Referer: PAGE } }, alternatives: [] }; setCachedVerifiedVariant('master', { ...v, alternatives: [v, v] }); const cached = getCachedVerifiedVariant('master')!; assert.equal(cached.alternatives?.length, 2); assert(!JSON.stringify(cached).includes('secret')); clearAllVerificationSessions(); });

  let created: any[] = [], stored: Record<string, any> = {}, gateCalls = 0;
  const service = isolate('src/browser/media-actions/browser-media-download.service.ts', {
    '@/downloads/quality': quality,
    '@/downloads/engine/social-source-refresh.provider': {},
    '@/media-detection/social-source/register-phase1-source-refresh': {},
    '@/media-detection/services/pre-download-gate.service': { runPreDownloadGate: async (input: any) => { gateCalls++; return { ok: true, finalUrl: input.sourceUrl, requestContext: input.requestContext, transport: input.transport, contentLength: 20_000 }; } },
    '@/media-detection/services/media-refresh.service': {},
    '@/media-detection/services/request-context.service': {},
    '@/media-detection/services/pending-media-resolution.service': { pendingMediaResolutionService: { get: () => null } },
    '@/store/downloads': { useDownloadsStore: { getState: () => ({ itemsById: stored, create: async (p: any) => { created.push(p); return { id: 'new-job' }; } }) } },
  });
  await test('invalid selected ID never falls back or enqueues', async () => { const r = await service.enqueueBrowserMediaDownload({ analysis, requestContext: ctx, selectedOptionId: 'missing', fingerprint: 'f' }); assert.equal(r.ok, false); assert.equal(created.length, 0); assert.equal(gateCalls, 0); });
  await test('enqueue dedupe uses chosen source, preserves request context', async () => { stored = { old: { id: 'old', sourceUrl: URL, status: 'COMPLETED' } }; const r = await service.enqueueBrowserMediaDownload({ analysis, requestContext: ctx, selectedOptionId: options[0].id, fingerprint: 'f' }); assert(r.ok); assert.equal(r.downloadId, 'new-job'); assert.equal(created[0].sourceUrl, options[0].sourceUrl); assert.equal(created[0].requestContext, ctx); });
  await test('same selected resource returns existing job', async () => { const r = await service.enqueueBrowserMediaDownload({ analysis, requestContext: ctx, selectedOptionId: options[1].id, fingerprint: 'f' }); assert.equal(r.downloadId, 'old'); assert.equal(created.length, 1); });
  await test('unknown resumability keeps Pause available', () => assert(resolveDownloadRuntimeActions({ status: 'DOWNLOADING' }).canPause));
  await test('known non-resumable source cannot strand a new pause', () => assert.equal(resolveDownloadRuntimeActions({ status: 'DOWNLOADING', sourceSupportsResume: false }).pauseBlockedReason, 'SOURCE_NOT_RESUMABLE'));
  await test('already-paused job can still resume', () => assert(resolveDownloadRuntimeActions({ status: 'PAUSED', sourceSupportsResume: false }).canResume));
  await test('200 after Range never permits blind append', () => assert.throws(() => validateRangeResumeResponse({ status: 200, offset: 1024 } as any)));

  const disk = new Map<string, Uint8Array>();
  const uriOf = (parts: any[]) => parts.map((p) => typeof p === 'string' ? p : p.uri).join('/').replace(/(?<!:)\/{2,}/g, '/').replace(/^file:\//, 'file:///');
  class FakeDirectory {
    uri: string;
    constructor(...parts: any[]) { this.uri = uriOf(parts).replace(/\/$/, '') + '/'; }
    exists = true;
    create() {}
  }
  let throwAfterMove = false;
  class FakeFile {
    uri: string;
    constructor(...parts: any[]) { this.uri = uriOf(parts); }
    get name() { return this.uri.split('/').pop()!; }
    get parentDirectory() { return new FakeDirectory(this.uri.slice(0, this.uri.lastIndexOf('/'))); }
    get exists() { return disk.has(this.uri); }
    get size() { return disk.get(this.uri)?.length ?? 0; }
    delete() { disk.delete(this.uri); }
    move(destination: FakeFile) { const bytes = disk.get(this.uri)!; disk.delete(this.uri); this.uri = destination.uri; disk.set(this.uri, bytes); if (throwAfterMove) throw new Error('late native move error'); }
    open(mode: string) {
      let offset = 0;
      if (mode === 'write') disk.set(this.uri, new Uint8Array());
      return {
        readBytes: (n: number) => { const value = disk.get(this.uri)?.slice(offset, offset + n) ?? new Uint8Array(); offset += value.length; return value; },
        writeBytes: (bytes: Uint8Array) => disk.set(this.uri, concat(disk.get(this.uri) ?? new Uint8Array(), bytes)),
        close() {},
      };
    }
  }
  const fs = { File: FakeFile, Directory: FakeDirectory, FileMode: { ReadOnly: 'read', WriteOnly: 'write' }, Paths: { document: 'file:///fixture/documents/' } };
  const paths = isolate('src/downloads/engine/file-paths.ts', { 'expo-file-system': fs });
  const validation = isolate('src/downloads/engine/media-validation.ts', { 'expo-file-system': fs });
  const finalizer = isolate('src/downloads/engine/finalize-download.ts', { './file-paths': paths, './media-validation': validation });
  const identity = isolate('src/downloads/completed-file/apply-identity.ts', { 'expo-file-system': fs, '@/downloads/engine/file-paths': paths, './index': { resolveCompletedDescriptor } });
  for (const [format, bytes] of Object.entries({ mp4, m4v: mp4, mov, webm, avi, wmv, fmp4 })) {
    await test(`finalization commits valid ${format} and verifies physical identity`, async () => {
      const destination = new FakeFile(paths.getDownloadItemDirectory('job'), `film.${format}`), partial = paths.getPartialTransferFile(destination);
      disk.set(partial.uri, bytes);
      const r = await finalizer.validateFinalDownloadFile({ file: partial, destination, expectedBytes: bytes.length, downloadId: 'job' });
      assert.equal(r.ok, true); assert.equal(r.finalUri, destination.uri); assert.equal(destination.size, bytes.length); assert(!partial.exists);
    });
  }
  for (const [label, bytes] of [['zero', new Uint8Array()], ['HTML', new Uint8Array(Buffer.from('<html>login</html>'.padEnd(20_000)))], ['JSON', new Uint8Array(Buffer.from('{"error":"denied"}'.padEnd(20_000)))]] as const) {
    await test(`finalization rejects ${label} bytes`, async () => {
      const destination = new FakeFile(paths.getDownloadItemDirectory('bad'), 'film.mp4'); disk.set(destination.uri, bytes);
      assert.equal((await finalizer.validateFinalDownloadFile({ file: destination, destination, expectedBytes: null, downloadId: 'bad' })).ok, false);
    });
  }
  await test('missing final file cannot become completed', async () => { const file = new FakeFile(paths.getDownloadItemDirectory('missing'), 'film.mp4'); assert.equal((await finalizer.validateFinalDownloadFile({ file, destination: file, expectedBytes: mp4.length, downloadId: 'missing' })).ok, false); });
  await test('size mismatch is never ignored after valid signature', async () => { const file = new FakeFile(paths.getDownloadItemDirectory('size'), 'film.mp4'); disk.set(file.uri, mp4); assert.equal((await finalizer.validateFinalDownloadFile({ file, destination: file, expectedBytes: mp4.length + 5000, downloadId: 'size' })).code, 'FINAL_SIZE_MISMATCH'); });
  await test('renamed MOV descriptor matches actual physical file', async () => {
    const file = new FakeFile(paths.getDownloadItemDirectory('rename'), 'film.mp4'); disk.set(file.uri, mov);
    const r = await identity.applyCompletedFileIdentity({ downloadId: 'rename', finalUri: file.uri, currentFileName: file.name, fileSize: mov.length, evidence: { signatureKind: 'mov', verifiedMimeType: 'video/quicktime' } });
    assert(r.localUri.endsWith('.mov')); assert(disk.has(r.localUri)); assert.equal(r.descriptor.canonicalPath, r.localUri);
  });
  await test('late native move failure retains the existing moved file', async () => {
    const file = new FakeFile(paths.getDownloadItemDirectory('late'), 'film.mp4'); disk.set(file.uri, mov); throwAfterMove = true;
    try {
      const r = await identity.applyCompletedFileIdentity({ downloadId: 'late', finalUri: file.uri, currentFileName: file.name, fileSize: mov.length, evidence: { signatureKind: 'mov', verifiedMimeType: 'video/quicktime' } });
      assert(disk.has(r.localUri)); assert.equal(r.fileName, new FakeFile(r.localUri).name);
    } finally { throwAfterMove = false; }
  });

  // These are integration contracts, not claims of Android execution.
  const contracts: [string, string, ...string[]][] = [
    ['native owner uses real event tag', 'src/browser/components/BrowserContainer/BrowserWebView.tsx', 'bindNativeScope', 'event.nativeEvent as { target?: number }'],
    ['engine rejects unowned/parked native traffic', 'src/media-detection/engine/media-detection.engine.ts', 'input.tabId !== this.activeTabId', 'input.navigationEpoch !== this.navigationEpoch'],
    ['service-worker shares passive native ingress', 'android/app/src/main/java/com/anonymous/vidorax/mediadetection/MediaNetworkBridge.kt', 'ServiceWorkerClient', 'observeRequestFrom', 'parentViewId', 'requestReferer'],
    ['child HLS playlists verified before quality publication', 'src/media-detection/general-source/general-source-reliability.service.ts', 'fetchBoundedHlsManifest(stream.uri', 'parseHlsPlaylist(child.text', 'child.finalUrl'],
    ['offer respects ownership', 'src/media-detection/general-source/general-source-reliability.service.ts', "scope.ownershipConfidence === 'REJECTED'", 'isGeneralScopeCurrent'],
    ['verified actionable CTA only', 'src/browser/media-actions/browser-media-action.service.ts', 'setVerified', 'claimForHandoff'],
    ['bar remains passive with direct Download UX', 'src/browser/media-actions/BrowserMediaDownloadBar.tsx', 'handleBarPress', 'presentation.buttonDisabled', 'action.download'],
    ['quality freeze protects stale confirmation', 'src/screens/downloads/quality/useQualitySelection.ts', 'isQualityFreezeStillCurrent', 'sameResourceFamily(payload.sourceUrl, refresh.mediaUrl)', 'executableUrl: selectedOption.sourceUrl'],
    ['same resource required for generic refresh', 'src/browser/media-actions/browser-media-download.service.ts', 'sameResourceFamily(payload.sourceUrl, refresh.mediaUrl)'],
    ['single source uses existing queue', 'src/browser/media-actions/browser-media-download.service.ts', 'useDownloadsStore.getState().create', 'requestContext: ctx'],
    ['multiple sources use existing queue', 'src/screens/downloads/quality/useQualitySelection.ts', 'await create({', 'toCreateDownloadInput(selection, selectedOption)'],
    ['canonical engine remains sole scheduler', 'src/downloads/engine/manager.ts', 'AdmissionScheduler', 'HlsTransferWorker', 'TransferWorker'],
    ['Wi-Fi policy remains in scheduler', 'src/downloads/scheduler/network-policy.ts', 'WAITING_FOR_WIFI'],
    ['final content verified before commit', 'src/downloads/engine/finalize-download.ts', 'verifyDownloadedMediaContent(input.file)', 'commitPartialToFinalFile', 'verifyCompletedFile(input.destination, input.expectedBytes'],
    ['physical identity verified before persistence', 'src/downloads/completed-file/apply-identity.ts', 'verifyCompletedFile(physical, input.fileSize', 'fileName = physical.name'],
    ['progressive verifies final renamed path', 'src/downloads/engine/worker.ts', 'verifyCompletedFile(new File(identityLocalUri)', 'localUri: identityLocalUri'],
    ['HLS verifies final renamed path', 'src/downloads/engine/hls/worker.ts', 'verifyCompletedFile(new File(identityLocalUri)', 'localUri: identityLocalUri'],
    ['Downloads immediate queue integration', 'src/store/downloads/actions.ts', 'downloadEngine.enqueue'],
    ['Library completion bridge retained', 'src/library/ensure-completion-bridge.ts', 'ensureLibraryCompletionBridge'],
    ['offline player resolves authoritative local file', 'src/player/resolve-playback-source.ts', 'deps.getLocalRecord', 'deps.verifyFile', 'uri: resolvedUri'],
    ['decoder failure offers Open externally', 'src/screens/player/PlayerScreen.tsx', 'openCompletedFile(mediaId)', 'player-open-externally'],
    ['Open/Share keep same descriptor', 'src/downloads/completed-file/action-service.ts', 'openCompletedFile', 'shareCompletedFile'],
    ['player navigation retained', 'src/navigation/helpers/open-player.ts', 'navigation.push(playerPath(mediaId))'],
    ['bounded observer and cleanup', 'src/media-detection/observers/injected-script.ts', 'MAX_SEEN = 320', 'disposed = true', 'clearTimeout(batchTimer)', '{ once: true }'],
    ['probe queue bounded with abort cleanup', 'src/media-detection/services/mime-probe.service.ts', 'waitQueue.length >= 48', 'waitQueue.indexOf(resume)', 'controller.abort()'],
    ['safe existing diagnostics', 'src/media-detection/social-source/social-source-diagnostics.ts', 'contentIdentityHash', 'variantIdHash'],
    ['8 tabs and 2 mounted WebViews', 'src/browser/tabs/constants.ts', '= 8', '= 2'],
  ];
  for (const [name, path, ...tokens] of contracts) await contract(name, path, ...tokens);
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
