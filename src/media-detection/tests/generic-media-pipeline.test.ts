/**
 * Phase 15A.5 — whatever feeds the video the user is watching (or asked for) is resolved, classified and either
 * offered or rejected with an explicit reason.
 *
 * Drives the production injected script through the real engine, correlation and verification (see
 * dynamic-detection-pipeline.ts): split vs muxed MediaSource players (including one created before the observer was
 * injected), and WebView downloads the user asked for — a pasted file the WebView cannot render, and an attachment
 * link clicked while another video plays.
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
import type { FakeElement } from './page-harness';
import { generalPageMediaContextStore } from '../general-media';
import { buildOwnershipKey, subscribeOwnership } from '../hooks/discovery-selection';
import { clearPipelineOutcomesForTests, getPipelineOutcomes } from '../pipeline/pipeline-outcome';
import { wholeFileUrl } from '../pipeline/split-tracks';
import { classifyMsePlayback } from '../engine/mse-playback-context';
import { useMediaDetectionStore } from '../stores';

const PAGE = 'https://videos.example.com/watch/abc123';
const PLAYER_RECT = { left: 20, top: 60, width: 340, height: 200 };
const VIDEO_HALF = 'https://cdn.example.com/media/clip-v720.mp4';
const AUDIO_HALF = 'https://cdn.example.com/media/clip-a128.mp4';
const MUXED = 'https://cdn.example.com/media/clip-av.mp4';

beforeEach(() => {
  stubFetch(mp4Everywhere());
  clearPipelineOutcomesForTests();
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
});

type PageMediaSource = ReturnType<PipelineRig['harness']['newMediaSource']>;

/** A visible, playing <video> attached to a MediaSource through its blob: URL. */
function msePlayer(rig: PipelineRig, blobUrl: string): FakeElement {
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: blobUrl },
    props: { currentSrc: blobUrl, networkState: 2, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  return video;
}

function openMediaSource(rig: PipelineRig, mimes: string[], options: { observeUrl?: boolean } = {}) {
  const ms: PageMediaSource = rig.harness.newMediaSource();
  const blobUrl =
    options.observeUrl === false
      ? 'blob:https://videos.example.com/0000-created-before-injection'
      : rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  for (const mime of mimes) {
    ms.addSourceBuffer(mime);
  }
  return blobUrl;
}

test('split A/V MediaSource player → both files resolved together, never one half as the video', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const blobUrl = openMediaSource(rig, ['video/mp4; codecs="avc1.4d401f"', 'audio/mp4; codecs="mp4a.40.2"']);
  msePlayer(rig, blobUrl);
  rig.tick();

  assert.equal(rig.mseState()?.trackLayout, 'split');
  // The page fetched its video half whole (no byte ranges): it must not be offered as "the video".
  rig.observeNativeRequest({ url: VIDEO_HALF, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: AUDIO_HALF, frameUrl: PAGE, mimeType: 'audio/mp4' });
  const offer = await rig.offer();
  assert.equal(offer.ok, false, 'a half is never offered on its own');

  // Once the pair has settled, both files are handed over together (newest first).
  const settled = classifyMsePlayback({ state: rig.mseState(), hasWholeSourceCandidate: true, nowMs: Date.now() + 3_000 });
  assert.equal(settled.kind, 'SPLIT_TRACKS');
  if (settled.kind === 'SPLIT_TRACKS') {
    assert.equal(settled.source, 'network');
    assert.deepEqual([...settled.candidateUrls].sort(), [AUDIO_HALF, VIDEO_HALF]);
  }
});

test('files a split player requested before its first report still resolve the pair (network evidence)', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  // A short video: both files are fetched (in byte ranges) before the page has reported its player.
  rig.observeNativeRequest({ url: `${VIDEO_HALF}?sig=v&bytestart=0&byteend=65535`, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: `${AUDIO_HALF}?sig=a&bytestart=0&byteend=65535`, frameUrl: PAGE, mimeType: 'audio/mp4' });
  const blobUrl = openMediaSource(rig, ['video/mp4; codecs="avc1.4d401f"', 'audio/mp4; codecs="mp4a.40.2"']);
  msePlayer(rig, blobUrl);
  rig.tick();

  assert.equal(rig.mseState()?.trackLayout, 'split');
  const settled = classifyMsePlayback({ state: rig.mseState(), hasWholeSourceCandidate: true, nowMs: Date.now() + 3_000 });
  assert.equal(settled.kind, 'SPLIT_TRACKS');
  if (settled.kind === 'SPLIT_TRACKS') {
    assert.equal(settled.source, 'network');
    assert.deepEqual([...settled.candidateUrls.map(wholeFileUrl)].sort(), [`${AUDIO_HALF}?sig=a`, `${VIDEO_HALF}?sig=v`]);
  }
  // Long after, still never "one file is the whole video".
  const later = classifyMsePlayback({ state: rig.mseState(), hasWholeSourceCandidate: true, nowMs: Date.now() + 20_000 });
  assert.equal(later.kind, 'SPLIT_TRACKS');
});

test('the page names the exact file behind each SourceBuffer → the pair is taken from the player itself', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  const audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  msePlayer(rig, blobUrl);
  rig.tick();
  // The next item's files are prefetched too — they never reach a SourceBuffer of this player.
  rig.observeNativeRequest({ url: 'https://cdn.example.com/media/next-v720.mp4', frameUrl: PAGE, mimeType: 'video/mp4' });
  await rig.harness.appendFetchedFile(videoBuffer, `${VIDEO_HALF}?sig=abc&bytestart=0&byteend=65535`);
  await rig.harness.appendFetchedFile(audioBuffer, `${AUDIO_HALF}?sig=def&bytestart=0&byteend=4095`);
  rig.tick();

  const resolution = rig.mseResolution(true);
  assert.equal(resolution.kind, 'SPLIT_TRACKS');
  if (resolution.kind === 'SPLIT_TRACKS') {
    assert.equal(resolution.source, 'buffers');
    assert.equal(wholeFileUrl(resolution.videoUrl!), `${VIDEO_HALF}?sig=abc`);
    assert.equal(wholeFileUrl(resolution.audioUrl!), `${AUDIO_HALF}?sig=def`);
  }
  const offer = await rig.offer();
  assert.equal(offer.ok, false);
  assert.equal(offer.ok === false ? offer.reason : null, 'SPLIT_TRACKS');
});

test('a split player built while the page loads (before the main script) is still paired from its buffers', async () => {
  const rig = createPipeline(PAGE);
  // Document start: only the before-content script has run when the page builds its player and appends both files.
  rig.harness.injectBeforeContent();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  const audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  await rig.harness.appendFetchedFile(videoBuffer, `${VIDEO_HALF}?sig=abc&bytestart=0&byteend=65535`);
  await rig.harness.appendFetchedFile(audioBuffer, `${AUDIO_HALF}?sig=def&bytestart=0&byteend=4095`);
  msePlayer(rig, blobUrl);
  // The page has loaded: the main script adopts what was observed and reports the player.
  rig.harness.inject();
  rig.tick();

  assert.equal(rig.mseState()?.trackLayout, 'split');
  const resolution = rig.mseResolution(true);
  assert.equal(resolution.kind, 'SPLIT_TRACKS');
  if (resolution.kind === 'SPLIT_TRACKS') {
    assert.equal(resolution.source, 'buffers');
    assert.equal(wholeFileUrl(resolution.videoUrl!), `${VIDEO_HALF}?sig=abc`);
    assert.equal(wholeFileUrl(resolution.audioUrl!), `${AUDIO_HALF}?sig=def`);
  }
});

test('the MediaSource hooks are installed once, whichever script runs first', () => {
  const rig = createPipeline(PAGE);
  rig.harness.injectBeforeContent();
  const apis = '[MediaSource.prototype.addSourceBuffer, SourceBuffer.prototype.appendBuffer, URL.createObjectURL]';
  const hooked = rig.harness.evaluate(apis) as unknown[];
  rig.harness.inject();
  rig.harness.injectBeforeContent();
  const after = rig.harness.evaluate(apis) as unknown[];
  hooked.forEach((fn, i) => assert.equal(after[i], fn, 'no second wrapper around the page’s MediaSource APIs'));
});

test('a new player drops the previous player’s tracks', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const first = rig.harness.newMediaSource();
  const firstBlob = rig.harness.createObjectUrlFor(first as unknown as Record<string, unknown>);
  first.readyState = 'open';
  const v1 = first.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  const a1 = first.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  const video = msePlayer(rig, firstBlob);
  await rig.harness.appendFetchedFile(v1, 'https://cdn.example.com/reel1-v.mp4');
  await rig.harness.appendFetchedFile(a1, 'https://cdn.example.com/reel1-a.mp4');
  rig.tick();
  assert.equal(rig.mseState()?.trackFiles?.video, 'https://cdn.example.com/reel1-v.mp4');

  // Next reel: the same element gets a new MediaSource; until it appends, nothing of reel 1 is paired with it.
  const second = rig.harness.newMediaSource();
  const secondBlob = rig.harness.createObjectUrlFor(second as unknown as Record<string, unknown>);
  second.readyState = 'open';
  const v2 = second.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  second.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  video.src = secondBlob;
  Object.assign(video, { currentSrc: secondBlob, networkState: 2, paused: false, readyState: 4 });
  rig.harness.fireMediaEvent(video, 'loadstart');
  await rig.harness.appendFetchedFile(v2, 'https://cdn.example.com/reel2-v.mp4');
  rig.tick();
  const state = rig.mseState();
  assert.notEqual(state?.trackFiles?.audio, 'https://cdn.example.com/reel1-a.mp4', 'reel 1 audio never pairs with reel 2');
  assert.notEqual(rig.mseResolution(true).kind, 'SPLIT_TRACKS');
});

/** Distinct, deterministic file contents (a tiny LCG), so appended bytes can only come from one file. */
function fileBytes(seed: number, length = 4096): Uint8Array {
  const bytes = new Uint8Array(length);
  let x = seed >>> 0;
  for (let i = 0; i < length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    bytes[i] = x >>> 24;
  }
  return bytes;
}

test('a player that streams its files and appends copies of the bytes is read from its SourceBuffers', async () => {
  // Facebook's reel viewer: every file is read through response.body in byte ranges, the next reels' files are
  // prefetched, and the buffers appended are copies — so only the bytes themselves say which file feeds each buffer.
  const NEXT_VIDEO = 'https://cdn.example.com/media/next-v720.mp4';
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  const audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  msePlayer(rig, blobUrl);
  await rig.harness.streamFile(null, `${NEXT_VIDEO}?sig=n&bytestart=0&byteend=4095`, fileBytes(3), { append: false });
  await rig.harness.streamFile(videoBuffer, `${VIDEO_HALF}?sig=abc&bytestart=8192&byteend=12287`, fileBytes(1), {
    from: 1500,
  });
  await rig.harness.streamFile(audioBuffer, `${AUDIO_HALF}?sig=def&bytestart=0&byteend=4095`, fileBytes(2), {
    contentType: 'audio/mp4',
    from: 700,
  });
  rig.observeNativeRequest({ url: `${NEXT_VIDEO}?sig=n&bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: `${VIDEO_HALF}?sig=abc&bytestart=8192&byteend=12287`, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: `${AUDIO_HALF}?sig=def&bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'audio/mp4' });
  rig.tick();

  const resolution = rig.mseResolution(true);
  assert.equal(resolution.kind, 'SPLIT_TRACKS');
  if (resolution.kind === 'SPLIT_TRACKS') {
    assert.equal(resolution.source, 'buffers', 'the page named each buffer’s file — no guess among three files');
    assert.equal(wholeFileUrl(resolution.videoUrl!), `${VIDEO_HALF}?sig=abc`);
    assert.equal(wholeFileUrl(resolution.audioUrl!), `${AUDIO_HALF}?sig=def`);
  }
});

test('a player that pipes each streamed file through its own transform into its own sink is read too', async () => {
  // What Facebook's reel viewer does: response.body.pipeThrough(transform).pipeTo(sink) — no reader is ever taken.
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  const audioBuffer = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  msePlayer(rig, blobUrl);
  const prefetch = 'https://cdn.example.com/media/next-a128.mp4?bytestart=0&byteend=4095';
  await rig.harness.streamFile(null, prefetch, fileBytes(5), { append: false, pipe: true });
  await rig.harness.streamFile(videoBuffer, `${VIDEO_HALF}?bytestart=0&byteend=4095`, fileBytes(6), { pipe: true });
  await rig.harness.streamFile(audioBuffer, `${AUDIO_HALF}?bytestart=0&byteend=4095`, fileBytes(7), {
    pipe: true,
    from: 2048,
  });
  rig.tick();

  const files = rig.mseState()?.trackFiles;
  assert.equal(wholeFileUrl(files?.video ?? ''), VIDEO_HALF);
  assert.equal(wholeFileUrl(files?.audio ?? ''), AUDIO_HALF);
});

test('a split player scrolled back to, replaying from the page cache, is current again by the files it names', async () => {
  // The reel's files were requested minutes ago under an earlier generation; nothing is requested again.
  const NEXT_V = 'https://cdn.example.com/media/next-v720.mp4';
  const NEXT_A = 'https://cdn.example.com/media/next-a128.mp4';
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const video = msePlayer(rig, 'blob:https://videos.example.com/placeholder');
  const show = async (files: [string, string, Uint8Array, Uint8Array]) => {
    const ms = rig.harness.newMediaSource();
    const blob = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
    ms.readyState = 'open';
    const v = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
    const a = ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    video.src = blob;
    Object.assign(video, { currentSrc: blob, networkState: 2, paused: false, readyState: 4 });
    rig.harness.fireMediaEvent(video, 'loadstart');
    await rig.harness.streamFile(v, `${files[0]}?bytestart=0&byteend=4095`, files[2], { pipe: true });
    await rig.harness.streamFile(a, `${files[1]}?bytestart=0&byteend=4095`, files[3], { pipe: true });
    rig.tick();
  };
  const reel1: [string, string, Uint8Array, Uint8Array] = [VIDEO_HALF, AUDIO_HALF, fileBytes(11), fileBytes(12)];
  await show(reel1);
  rig.observeNativeRequest({ url: `${VIDEO_HALF}?bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: `${AUDIO_HALF}?bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'audio/mp4' });
  rig.tick();
  await show([NEXT_V, NEXT_A, fileBytes(13), fileBytes(14)]);
  rig.observeNativeRequest({ url: `${NEXT_V}?bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: `${NEXT_A}?bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'audio/mp4' });
  rig.tick();

  const store = useMediaDetectionStore.getState();
  useMediaDetectionStore.setState({
    detectedMedia: store.detectedMedia.map((m) => ({ ...m, detectedAt: m.detectedAt - 10 * 60_000 })),
  });
  await show(reel1);

  const selected = rig.selected();
  assert.ok(selected, 'the scrolled-back reel has a current source');
  assert.ok([VIDEO_HALF, AUDIO_HALF].includes(wholeFileUrl(selected.finalUrl || selected.url)), selected.url);
  const resolution = rig.mseResolution(true);
  assert.equal(resolution.kind, 'SPLIT_TRACKS');
  if (resolution.kind === 'SPLIT_TRACKS') {
    assert.equal(wholeFileUrl(resolution.videoUrl!), VIDEO_HALF);
    assert.equal(wholeFileUrl(resolution.audioUrl!), AUDIO_HALF);
  }
});

test('appended bytes found in two streamed files name neither file', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  msePlayer(rig, blobUrl);
  await rig.harness.streamFile(null, 'https://cdn.example.com/media/other-v720.mp4', fileBytes(9), { append: false });
  await rig.harness.streamFile(videoBuffer, VIDEO_HALF, fileBytes(9), { from: 100 });
  rig.tick();

  assert.equal(rig.mseState()?.trackFiles?.video ?? null, null);
});

test('a streamed response that is not media is never kept', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const ms = rig.harness.newMediaSource();
  const blobUrl = rig.harness.createObjectUrlFor(ms as unknown as Record<string, unknown>);
  ms.readyState = 'open';
  const videoBuffer = ms.addSourceBuffer('video/mp4; codecs="avc1.4d401f"');
  ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
  msePlayer(rig, blobUrl);
  await rig.harness.streamFile(videoBuffer, 'https://api.example.com/graphql', fileBytes(4), {
    contentType: 'application/json',
  });
  rig.tick();

  assert.equal(rig.mseState()?.trackFiles?.video ?? null, null);
  assert.equal(rig.harness.evaluate('window.__VIDORAX_MSE__.streamChunks.length'), 0);
});

test('muxed MediaSource player → its whole muxed file is still offered', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const blobUrl = openMediaSource(rig, ['video/mp4; codecs="avc1.4d401e,mp4a.40.2"']);
  msePlayer(rig, blobUrl);
  rig.tick();

  assert.equal(rig.mseState()?.trackLayout, 'muxed');
  rig.observeNativeRequest({ url: MUXED, frameUrl: PAGE, mimeType: 'video/mp4' });
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected the muxed source to be offered, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MUXED);
});

test('a MediaSource created before the observer was injected is still read from its SourceBuffers', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  // createObjectURL happened before injection: the blob URL was never mapped to its MediaSource.
  const blobUrl = openMediaSource(
    rig,
    ['video/webm; codecs="vp9"', 'audio/webm; codecs="opus"'],
    { observeUrl: false },
  );
  msePlayer(rig, blobUrl);
  rig.tick();

  assert.equal(rig.mseState()?.sourceKind, 'mse');
  assert.equal(rig.mseState()?.trackLayout, 'split');
  rig.observeNativeRequest({ url: `${VIDEO_HALF}?bytestart=0&byteend=65535`, frameUrl: PAGE, mimeType: 'video/mp4' });
  // One half seen so far: nothing is offered while the other is still expected.
  assert.deepEqual(await rig.offer(), { ok: false, reason: 'MSE_SPLIT_TRACKS_PENDING' });
  rig.observeNativeRequest({ url: `${AUDIO_HALF}?bytestart=0&byteend=4095`, frameUrl: PAGE, mimeType: 'audio/mp4' });
  assert.equal((await rig.offer()).ok, false);
  const settled = classifyMsePlayback({ state: rig.mseState(), hasWholeSourceCandidate: true, nowMs: Date.now() + 3_000 });
  assert.equal(settled.kind, 'SPLIT_TRACKS');
  if (settled.kind === 'SPLIT_TRACKS') {
    // The byte-ranged requests name whole files once their range parameters are dropped.
    assert.deepEqual(settled.candidateUrls.map(wholeFileUrl).sort(), [AUDIO_HALF, VIDEO_HALF]);
  }
});

test('a player that demuxes ONE stream into two buffers (hls.js + MPEG-TS) is not split A/V', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  const blobUrl = openMediaSource(rig, ['video/mp4; codecs="avc1.42c01e"', 'audio/mp4; codecs="mp4a.40.2"']);
  msePlayer(rig, blobUrl);
  rig.tick();
  assert.equal(rig.mseState()?.trackLayout, 'split');
  rig.observeNativeRequest({ url: 'https://cdn.example.com/hls/master.m3u8', frameUrl: PAGE });
  rig.observeNativeRequest({ url: 'https://cdn.example.com/hls/360/index.m3u8', frameUrl: PAGE });
  const resolution = rig.mseResolution(true);
  assert.notEqual(resolution.kind, 'UNSUPPORTED', 'the manifest decides, not the buffer layout');
});

test('a pasted file the WebView cannot render (no player at all) is offered as the page media', async () => {
  const MOV = 'https://files.example.com/share/holiday.mov';
  const rig = createPipeline(MOV);
  rig.harness.inject();
  rig.tick();

  // The navigation became a download: only the request is known, no element plays it.
  rig.observeNativeRequest({ url: MOV, mimeType: null });
  assert.notEqual(rig.selected()?.userRequested, true, 'a passive request is not a user request');

  rig.observeUserDownload({ url: MOV, mimeType: 'video/quicktime' });
  assert.equal(rig.selected()?.url, MOV);
  assert.equal(rig.selected()?.userRequested, true);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected the requested file to be offered, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MOV);
});

test('an attachment clicked while another video plays becomes the offer — and only it', async () => {
  const PLAYING = 'https://videos.example.com/media/feature.mp4';
  const CLICKED = 'https://videos.example.com/dl/extra.mp4';
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: PLAYING },
    props: { currentSrc: PLAYING, networkState: 2, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.inject();
  rig.harness.setIntersection([{ element: video, ratio: 1 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  const before = await rig.offer();
  assert.ok(before.ok);
  assert.equal(before.url, PLAYING);
  const identityBefore = generalPageMediaContextStore.get(rig.tabId)?.currentMediaIdentity;

  rig.observeUserDownload({ url: CLICKED, mimeType: 'video/mp4' });
  const context = generalPageMediaContextStore.get(rig.tabId);
  assert.notEqual(context?.currentMediaIdentity, identityBefore, 'the request is the page media now');
  assert.equal(rig.selected()?.url, CLICKED);

  const after = await rig.offer();
  assert.ok(after.ok, `expected the clicked file to be offered, got ${JSON.stringify(after)}`);
  assert.equal(after.url, CLICKED);
  assert.deepEqual(
    after.offer.variants.map((v) => v.executableUrl),
    [CLICKED],
    'the playing video is not a "quality" of the clicked file',
  );

  // The page keeps reporting the same player: the request stays current.
  rig.harness.fireMediaEvent(video, 'timeupdate');
  rig.tick();
  assert.equal(rig.selected()?.url, CLICKED);

  // The player moves on to another source: that is the current video again.
  const NEXT = 'https://videos.example.com/media/next.mp4';
  video.src = NEXT;
  Object.assign(video, { currentSrc: NEXT });
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();
  assert.equal(
    generalPageMediaContextStore.get(rig.tabId)?.requestedMediaIdentity ?? null,
    null,
    'a new source on the player ends the request',
  );
});

test('dropped native requests are recorded with an explicit reason', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  // A request of a navigation this tab has already left.
  rig.observeNativeRequest({ url: MUXED, epochOverride: rig.epoch - 1 });
  const stale = getPipelineOutcomes(rig.tabId).find((entry) => entry.stage === 'detector');
  assert.equal(stale?.outcome, 'STALE');
  assert.equal(stale?.reason, 'STALE_GENERATION');
});

test('a manifest requested before the MediaSource existed still exempts a split-buffer player', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  // hls.js loads the playlist first, then creates and attaches its MediaSource.
  rig.observeNativeRequest({ url: 'https://cdn.example.com/hls/master.m3u8', frameUrl: PAGE });
  const blobUrl = openMediaSource(rig, ['video/mp4; codecs="avc1.42c01e"', 'audio/mp4; codecs="mp4a.40.2"']);
  msePlayer(rig, blobUrl);
  rig.tick();
  // The playlist predates the player; it is still that page's evidence, given to the player it reports next.
  assert.equal(rig.mseState()?.manifestObservations ?? 0, 1, 'the playlist request counts for the player');
  const offer = await rig.offer();
  assert.notEqual(offer.ok ? null : offer.reason, 'SPLIT_AUDIO_VIDEO');
  assert.notEqual(offer.ok ? null : offer.reason, 'MSE_SPLIT_TRACKS_PENDING');
});

test('protection appearing on a playing player re-runs selection even when nothing else on the page changes', () => {
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MUXED },
    props: { currentSrc: MUXED, networkState: 2, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.inject();
  rig.harness.setIntersection([{ element: video, ratio: 1 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();
  const before = buildOwnershipKey(rig.tabId);
  let notified = 0;
  const unsubscribe = subscribeOwnership(() => {
    notified += 1;
  });
  try {
    rig.harness.requestMediaKeySystemAccess('org.w3.clearkey');
    rig.tick();
  } finally {
    unsubscribe();
  }
  assert.equal(rig.mseState()?.protection, 'PROTECTED');
  assert.ok(notified > 0, 'ownership subscribers must hear about it');
  assert.notEqual(buildOwnershipKey(rig.tabId), before);
});

test('Back to a page restored from the back-forward cache: its player announced before the navigation still counts', async () => {
  const PAGE_A = 'https://videos.example.com/watch?v=A1';
  const PAGE_B = 'https://videos.example.com/watch?v=B2';
  const FILE_A = 'https://cdn.example.com/v/a.mp4';
  const FILE_B = 'https://cdn.example.com/v/b.mp4';
  const player = (harness: PipelineRig['harness'], src: string) => {
    const video = harness.appendToBody({
      tag: 'video',
      attrs: { src },
      props: { currentSrc: src, networkState: 2, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
      rect: PLAYER_RECT,
    });
    harness.inject();
    harness.setIntersection([{ element: video, ratio: 1 }]);
    harness.fireMediaEvent(video, 'play');
    harness.advance(600);
  };
  const rig = createPipeline(PAGE_A);
  player(rig.harness, FILE_A);
  rig.pump();
  rig.observeNativeRequest({ url: FILE_A, frameUrl: PAGE_A, mimeType: 'video/mp4' });
  const onA = await rig.offer();
  assert.ok(onA.ok);
  assert.equal(onA.url, FILE_A);

  rig.linkNavigate(PAGE_B);
  player(rig.harness, FILE_B);
  rig.pump();
  rig.observeNativeRequest({ url: FILE_B, frameUrl: PAGE_B, mimeType: 'video/mp4' });
  const onB = await rig.offer();
  assert.ok(onB.ok);
  assert.equal(onB.url, FILE_B);

  // Back: page A comes back from the cache and posts its player before the browser reports the navigation. Its media
  // is not requested again (the cache has it); only the page's own announcement tells the engine what plays.
  rig.restoreBeforeNavigation(PAGE_A, (harness) => player(harness, FILE_A));
  rig.observeNativeRequest({ url: FILE_A, frameUrl: PAGE_A, mimeType: 'video/mp4' });
  assert.equal(generalPageMediaContextStore.get(rig.tabId)?.activeVideoCurrentSrc, FILE_A);
  const back = await rig.offer();
  assert.ok(back.ok, `expected page A's video to be offered again, got ${JSON.stringify(back)}`);
  assert.equal(back.url, FILE_A);
});
