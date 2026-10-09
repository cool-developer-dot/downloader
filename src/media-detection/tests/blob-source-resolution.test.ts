/**
 * Phase 11B — a blob:/MediaSource player must be resolved to its real HTTP(S) source, or classified.
 *
 * Every case drives the production injected script in a DOM, through the real engine, correlation,
 * protection classification and verification. `blob:` itself is never a candidate and never an offer.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import {
  createPipeline,
  mp4Everywhere,
  resetPipeline,
  restoreFetch,
  stubFetch,
  type PipelineRig,
} from './dynamic-detection-pipeline';
import {
  MSE_SEGMENT_SETTLE_MS,
  MSE_SILENT_GIVE_UP_MS,
  classifyMsePlayback,
  type MsePlaybackState,
  isSplitPlayerFile,
} from '../engine/mse-playback-context';

const PAGE = 'https://videos.example.com/watch/abc123';
const MP4 = 'https://cdn.example.com/media/clip-720p.mp4';
const WEBM = 'https://cdn.example.com/media/clip-720p.webm';
const BLOB = 'blob:https://videos.example.com/6f2a-1111-2222';
const PLAYER_RECT = { left: 20, top: 60, width: 340, height: 200 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
});

/** A visible, playing <video src="blob:…"> — the shape every MSE player takes in the DOM. */
function blobPlayer(rig: PipelineRig, options: { src?: string } = {}) {
  const src = options.src ?? BLOB;
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src },
    props: { currentSrc: src, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  return video;
}

function urls(rig: PipelineRig): string[] {
  return rig.candidates().map((c) => c.url);
}

test('1 — a blob-backed HTML5 player resolves to its underlying MP4', async () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  assert.ok(rig.mseState(), 'the blob sighting must be recorded as player evidence');
  assert.deepEqual(urls(rig), [], 'blob: is never a candidate');

  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });

  assert.deepEqual(urls(rig), [MP4]);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected the underlying source to be offered, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('2 — a MediaSource player is recognised as MSE from createObjectURL', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  // The page builds an MSE pipeline: MediaSource carries no `type`, only `addSourceBuffer`.
  const blobUrl = rig.harness.createObjectUrlFor({ addSourceBuffer: () => undefined });
  rig.tick();

  const state = rig.mseState();
  assert.ok(state, 'a MediaSource object URL must be recorded');
  assert.equal(state?.sourceKind, 'mse', 'the player must be known to be MediaSource-backed');
  assert.ok(blobUrl.startsWith('blob:'));
  assert.deepEqual(urls(rig), [], 'blob: is never a candidate');
});

test('3 — an iframe blob player resolves from the request its own frame made', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  const embed = rig.harness.appendSameOriginIframe({
    src: 'https://videos.example.com/embed/abc123',
    rect: { left: 10, top: 40, width: 360, height: 220 },
    video: { url: BLOB, rect: { left: 0, top: 0, width: 360, height: 220 }, props: { paused: false } },
  });
  rig.harness.setIntersection([{ element: embed.frame, ratio: 0.9 }]);
  rig.tick();

  assert.ok(rig.mseState(), 'the subframe blob player must be recorded');
  assert.deepEqual(urls(rig), [], 'blob: is never a candidate');

  rig.observeNativeRequest({
    url: MP4,
    frameUrl: 'https://videos.example.com/embed/abc123',
    mimeType: 'video/mp4',
  });

  assert.deepEqual(urls(rig), [MP4]);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('4 — a JS-generated blob player created after load resolves to its source', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.mseState(), null, 'nothing playing yet');

  const blobUrl = rig.harness.createObjectUrlFor({ type: 'video/mp4' });
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: blobUrl },
    props: { currentSrc: blobUrl, paused: false, videoWidth: 1280, videoHeight: 720 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  assert.ok(rig.mseState(), 'the late blob player must be recorded');
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });

  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('5 — underlying MP4 source is verified as MP4', async () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });

  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  const variant = offer.offer.variants.find((v) => v.executableUrl === MP4);
  assert.ok(variant?.downloadable, 'the resolved MP4 must be downloadable');
  assert.equal(variant?.transport, 'progressive');
});

test('6 — underlying WebM source is verified as WebM', async () => {
  stubFetch((url) =>
    url.startsWith(WEBM)
      ? { contentType: 'video/webm', totalBytes: 4_000_000, container: 'webm' as const }
      : null,
  );
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();
  rig.observeNativeRequest({ url: WEBM, frameUrl: PAGE, mimeType: 'video/webm' });

  assert.deepEqual(urls(rig), [WEBM]);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, WEBM);
  assert.equal(offer.offer.variants[0]?.mimeType, 'video/webm');
});

test('7 — an encrypted MSE player is PROTECTED and never offered', async () => {
  const rig = createPipeline(PAGE);
  const video = blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  // EME: the element gets MediaKeys and the stream reports encrypted samples.
  (video as unknown as { mediaKeys: unknown }).mediaKeys = { keySystem: 'com.widevine.alpha' };
  rig.harness.fireMediaEvent(video, 'encrypted');
  rig.tick();

  assert.equal(rig.mseState()?.protection, 'PROTECTED');
  assert.equal(rig.mseResolution().kind, 'PROTECTED');

  // Even with a perfectly good HTTP(S) media request on the same page, nothing may be offered.
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });
  const offer = await rig.offer();
  assert.equal(offer.ok, false);
  assert.equal(offer.ok === false ? offer.reason : null, 'PROTECTED_UNSUPPORTED');
});

test('7b — EME negotiation alone marks the player protected', async () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.mseState()?.protection, 'NONE');

  rig.harness.requestMediaKeySystemAccess();
  rig.tick();

  assert.equal(rig.mseState()?.protection, 'PROTECTED');
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });
  const offer = await rig.offer();
  assert.equal(offer.ok, false);
  assert.equal(offer.ok === false ? offer.reason : null, 'PROTECTED_UNSUPPORTED');
});

test('8 — a segments-only MSE player is UNSUPPORTED, never a false download', async () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  for (const url of [
    'https://cdn.example.com/dash/init.mp4',
    'https://cdn.example.com/dash/segment-1.m4s',
    'https://cdn.example.com/dash/segment-2.m4s',
    'https://cdn.example.com/dash/segment-3.m4s',
  ]) {
    rig.observeNativeRequest({ url, frameUrl: PAGE, mimeType: 'video/mp4' });
  }

  assert.deepEqual(urls(rig), [], 'segments are never downloadable candidates');
  const state = rig.mseState();
  assert.ok(state && state.segmentObservations >= 3, 'segment traffic must be counted');

  // Before the settle window, "still looking" — never "can't be downloaded".
  assert.equal(classifyMsePlayback({ state, hasWholeSourceCandidate: false }).kind, 'PENDING');

  const settled = classifyMsePlayback({
    state,
    hasWholeSourceCandidate: false,
    nowMs: state!.firstSeenAt + MSE_SEGMENT_SETTLE_MS,
  });
  assert.equal(settled.kind, 'UNSUPPORTED');
  assert.equal(settled.kind === 'UNSUPPORTED' ? settled.detail : null, 'SEGMENTED_ONLY');

  const offer = await rig.offer();
  assert.equal(offer.ok, false);
});

test('8b — a silent blob player becomes UNSUPPORTED only after the give-up window', () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  const state = rig.mseState();
  assert.ok(state);
  assert.equal(classifyMsePlayback({ state, hasWholeSourceCandidate: false }).kind, 'PENDING');

  const late = classifyMsePlayback({
    state,
    hasWholeSourceCandidate: false,
    nowMs: state!.firstSeenAt + MSE_SILENT_GIVE_UP_MS,
  });
  assert.equal(late.kind, 'UNSUPPORTED');
  assert.equal(late.kind === 'UNSUPPORTED' ? late.detail : null, 'NO_SOURCE_OBSERVED');
});

test('9 — a whole-file source arriving late beats an earlier segments-only verdict', () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  for (const url of ['https://cdn.example.com/dash/segment-1.m4s', 'https://cdn.example.com/dash/segment-2.m4s', 'https://cdn.example.com/dash/segment-3.m4s']) {
    rig.observeNativeRequest({ url, frameUrl: PAGE, mimeType: 'video/mp4' });
  }
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });

  const state = rig.mseState();
  assert.equal(
    classifyMsePlayback({
      state,
      hasWholeSourceCandidate: true,
      nowMs: state!.firstSeenAt + MSE_SILENT_GIVE_UP_MS,
    }).kind,
    'RESOLVABLE',
  );
});

test('10 — a stale request from the previous page never resolves the new page\'s player', async () => {
  const rig = createPipeline(PAGE);
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();
  const staleEpoch = rig.mseState()!.navigationEpoch;

  rig.navigate('https://other.example.org/watch/zzz');
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.mseState(), null, 'the previous page\'s blob evidence must be discarded');

  // The old page's media request lands after the navigation.
  rig.observeNativeRequest({
    url: MP4,
    frameUrl: PAGE,
    mimeType: 'video/mp4',
    epochOverride: staleEpoch,
    pageUrlOverride: PAGE,
  });

  assert.deepEqual(urls(rig), [], 'a stale observation must not become a candidate');
  const offer = await rig.offer();
  assert.equal(offer.ok, false);
});

test('11 — blob evidence is per tab: one tab\'s player never explains another tab', () => {
  const rig = createPipeline(PAGE, { tabId: 'tab-A' });
  blobPlayer(rig);
  rig.harness.inject();
  rig.tick();
  assert.ok(rig.mseState(), 'tab-A has a blob player');

  const other = createPipeline('https://elsewhere.example.com/read', { tabId: 'tab-B' });
  other.harness.inject();
  other.tick();
  assert.equal(other.mseState(), null, 'tab-B must not inherit tab-A blob evidence');
});

test('12 — protection is sticky for the life of the player', () => {
  const rig = createPipeline(PAGE);
  const video = blobPlayer(rig);
  rig.harness.inject();
  rig.tick();

  (video as unknown as { mediaKeys: unknown }).mediaKeys = { keySystem: 'com.widevine.alpha' };
  rig.harness.fireMediaEvent(video, 'encrypted');
  rig.tick();
  assert.equal(rig.mseState()?.protection, 'PROTECTED');

  // A later sighting that happens to carry no key evidence must not un-protect the player.
  (video as unknown as { mediaKeys: unknown }).mediaKeys = null;
  rig.harness.fireMediaEvent(video, 'playing');
  rig.tick();
  assert.equal(rig.mseState()?.protection, 'PROTECTED');
});

test('13 — a player that fetches the whole file first, then plays it from a Blob, resolves to that file', async () => {
  const rig = createPipeline(PAGE);
  // The page's <video> is in the document from the start, still without a source.
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { autoplay: '' },
    props: { currentSrc: '', paused: true, videoWidth: 0, videoHeight: 0, readyState: 0 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.inject();
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.tick();

  // fetch(url).then((r) => r.blob()): the whole file is requested before the element has any source…
  rig.observeNativeRequest({ url: MP4, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.tick();

  // …then that Blob becomes the element's first source and plays. Nothing was showing before, so this is the
  // same content — not a recycled player — and the request that fed the Blob still belongs to it.
  const blobUrl = rig.harness.createObjectUrlFor({ type: 'video/mp4' });
  video.src = blobUrl;
  Object.assign(video, { currentSrc: blobUrl, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 });
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  assert.deepEqual(urls(rig), [MP4], 'blob: is never a candidate; the fetched file is');
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected the fetched file to be offered, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('classifier — no player means no verdict at all', () => {
  const resolution = classifyMsePlayback({ state: null, hasWholeSourceCandidate: false });
  assert.equal(resolution.kind, 'NONE');
});

test('classifier — protection outranks an available whole-file source', () => {
  const state: MsePlaybackState = {
    tabId: 'tab-1',
    navigationEpoch: 1,
    pageGeneration: 1,
    pageUrl: PAGE,
    elementIdentity: 'v1',
    sourceKind: 'mse',
    protection: 'PROTECTED',
    trackLayout: null,
    segmentObservations: 0,
    wholeSourceObservations: 5,
    firstSeenAt: 1_000,
    lastSeenAt: 1_000,
  };
  assert.equal(classifyMsePlayback({ state, hasWholeSourceCandidate: true }).kind, 'PROTECTED');
});

test('a whole file the split player never read is not one of its halves; its own files are, from any CDN edge', () => {
  const state = {
    fileUrls: [
      { key: 'a', url: 'https://video-a1.fbcdn.net/v/t42/AQV_video_half_720.mp4?bytestart=0&byteend=9', lastSeenAt: 1 },
    ],
    trackFiles: { video: null, audio: 'https://video-a1.fbcdn.net/v/t42/AQA_audio_half_128.mp4?bytestart=0' },
  };
  assert.equal(isSplitPlayerFile(state, 'https://video-b2.fbcdn.net/v/t42/AQV_video_half_720.mp4?oh=x'), true);
  assert.equal(isSplitPlayerFile(state, 'https://video-b2.fbcdn.net/v/t42/AQA_audio_half_128.mp4'), true);
  assert.equal(isSplitPlayerFile(state, 'https://video-c3.fbcdn.net/v/t39/AQM_whole_muxed_file.mp4?efg=1'), false);
  // Nothing known: treated as a half, so the split rule keeps withdrawing it.
  assert.equal(isSplitPlayerFile(null, 'https://video-c3.fbcdn.net/v/t39/AQM_whole_muxed_file.mp4'), true);
  assert.equal(isSplitPlayerFile(state, null), true);
});
