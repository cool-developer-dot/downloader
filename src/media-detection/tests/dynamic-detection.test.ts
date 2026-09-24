/**
 * Phase 11A — late / dynamic media must reach the real pipeline.
 *
 * Every case drives the production injected script in a DOM and asserts the result at the end of the
 * live path (WebView observation → scoped candidate → correlation → verification → offer). Nothing here
 * asserts "a regex matches" or "an observer exists".
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

const PAGE = 'https://videos.example.com/watch/abc123';
const MP4 = 'https://cdn.example.com/media/clip-720p.mp4';
const MP4_ALT = 'https://cdn.example.com/media/clip-1080p.mp4';
const EXTENSIONLESS = 'https://cdn.example.com/stream/8f2a91c4b7';
const QUERY_MP4 = 'https://cdn.example.com/media/clip.mp4?Expires=1789&Signature=abc&Key-Pair-Id=K123';
const PLAYER_ORIGIN = 'https://player.example.net';

const PLAYER_RECT = { left: 20, top: 60, width: 340, height: 200 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
});

/** Mounts a visible, playing <video> and settles the pipeline. */
function playVideo(rig: PipelineRig, url: string, ratio = 0.9) {
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: url },
    props: { currentSrc: url, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();
  return video;
}

function urls(rig: PipelineRig): string[] {
  return rig.candidates().map((c) => c.url);
}

test('1 — direct MP4 present at load reaches a verified offer', async () => {
  const rig = createPipeline(PAGE);
  playVideo(rig, MP4);
  rig.harness.inject();
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `expected ${MP4} among ${JSON.stringify(urls(rig))}`);
  assert.equal(rig.selected()?.url, MP4);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('2 — extensionless MP4 is probed and offered', async () => {
  stubFetch((url) =>
    url.startsWith(EXTENSIONLESS) ? { contentType: 'video/mp4', totalBytes: 9_000_000 } : null,
  );
  const rig = createPipeline(PAGE);
  playVideo(rig, EXTENSIONLESS);
  rig.harness.inject();
  rig.tick();
  // The MIME probe is async; let its promise chain settle.
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(urls(rig).includes(EXTENSIONLESS), `probe did not admit it: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, EXTENSIONLESS);
});

test('3 — MP4 with signed query parameters keeps its full executable URL', async () => {
  const rig = createPipeline(PAGE);
  playVideo(rig, QUERY_MP4);
  rig.harness.inject();
  rig.tick();

  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, QUERY_MP4, 'the signature must survive into the offer');
});

test('4 — a <video> created by JS after load is detected', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.candidates().length, 0, 'nothing on the page yet');

  playVideo(rig, MP4);

  assert.ok(urls(rig).includes(MP4), `late video missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('5 — delayed player initialisation (empty <video>, src set later) is detected', async () => {
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    rect: PLAYER_RECT,
    props: { videoWidth: 1280, videoHeight: 720 },
  });
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.candidates().length, 0, 'an empty player is not media');

  // The player library attaches the source some time after boot.
  video.src = MP4;
  video.currentSrc = MP4;
  video.readyState = 1;
  rig.harness.fireMediaEvent(video, 'loadedmetadata');
  video.paused = false;
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `delayed init missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('6 — a src/currentSrc change on a live player re-targets the offer', async () => {
  const rig = createPipeline(PAGE);
  const video = playVideo(rig, MP4);
  rig.harness.inject();
  rig.tick();
  let offer = await rig.offer();
  assert.ok(offer.ok && offer.url === MP4);

  // Quality switch: same element, new resource.
  video.src = MP4_ALT;
  video.currentSrc = MP4_ALT;
  rig.harness.fireMediaEvent(video, 'loadedmetadata');
  rig.harness.fireMediaEvent(video, 'playing');
  rig.tick();

  assert.ok(urls(rig).includes(MP4_ALT), `changed src missed: ${JSON.stringify(urls(rig))}`);
  offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4_ALT, 'the offer must follow the element to its new source');
});

test('7 — a <source> inserted into a live <video> is detected', async () => {
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    rect: PLAYER_RECT,
    props: { videoWidth: 1280, videoHeight: 720 },
  });
  rig.harness.inject();
  rig.tick();

  video.appendChild(rig.harness.createElement({ tag: 'source', attrs: { src: MP4, type: 'video/mp4' } }));
  video.currentSrc = MP4;
  video.readyState = 1;
  rig.harness.fireMediaEvent(video, 'loadedmetadata');
  video.paused = false;
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `inserted <source> missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
});

test('8 — a cross-origin iframe player added after load becomes the owner and its media is offered', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  const iframe = rig.harness.appendToBody({
    tag: 'iframe',
    attrs: { src: `${PLAYER_ORIGIN}/embed/abc123`, allowfullscreen: '' },
    rect: { left: 10, top: 40, width: 360, height: 220 },
  });
  rig.harness.setIntersection([{ element: iframe, ratio: 0.9 }]);
  rig.tick();

  // The player frame requests its own media. A cross-origin frame is invisible to the page script, so
  // the only observer is the patched WebView's native request hook.
  rig.observeNativeRequest({ url: MP4, frameUrl: `${PLAYER_ORIGIN}/embed/abc123`, mimeType: 'video/mp4' });

  assert.ok(urls(rig).includes(MP4), `iframe media missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('8b — a same-origin iframe player added after load is detected from the page', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  const embed = rig.harness.appendSameOriginIframe({
    src: 'https://videos.example.com/embed/abc123',
    rect: { left: 10, top: 40, width: 360, height: 220 },
    video: { url: MP4, rect: { left: 0, top: 0, width: 360, height: 220 }, props: { paused: false } },
  });
  rig.harness.setIntersection([{ element: embed.frame, ratio: 0.9 }]);
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `same-origin embed missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4);
});

test('8c — media inside a same-origin iframe that appears later is detected', async () => {
  const rig = createPipeline(PAGE);
  const embed = rig.harness.appendSameOriginIframe({
    src: 'https://videos.example.com/embed/abc123',
    rect: { left: 10, top: 40, width: 360, height: 220 },
    video: { url: MP4, rect: { left: 0, top: 0, width: 360, height: 220 } },
  });
  rig.harness.inject();
  rig.harness.setIntersection([{ element: embed.frame, ratio: 0.9 }]);
  rig.tick();

  // The embedded player swaps to a different rendition after it boots.
  embed.video.src = MP4_ALT;
  embed.video.currentSrc = MP4_ALT;
  embed.video.paused = false;
  embed.document.dispatchMediaEvent(embed.video, 'playing');
  rig.tick();

  assert.ok(urls(rig).includes(MP4_ALT), `late subframe change missed: ${JSON.stringify(urls(rig))}`);
});

test('9 — SPA navigation to a new video offers the new media, not the old', async () => {
  const rig = createPipeline(PAGE);
  const first = playVideo(rig, MP4);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.selected()?.url, MP4);

  // The app swaps the player and pushes a new route.
  rig.harness.document.body.removeChild(first);
  rig.harness.spaNavigate('https://videos.example.com/watch/def456');
  const next = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MP4_ALT },
    props: { currentSrc: MP4_ALT, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: next, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(next, 'play');
  rig.tick();

  assert.equal(rig.selected()?.url, MP4_ALT, `SPA route change did not re-target: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4_ALT);
});

test('10 — a recycled player element that swaps resource re-targets the offer', async () => {
  const rig = createPipeline(PAGE);
  const a = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MP4 },
    props: { currentSrc: MP4, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  const offscreen = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MP4_ALT },
    props: { currentSrc: MP4_ALT, paused: true, videoWidth: 1280, videoHeight: 720 },
    rect: { left: 20, top: 1400, width: 340, height: 200 },
  });
  rig.harness.setIntersection([
    { element: a, ratio: 0.95 },
    { element: offscreen, ratio: 0 },
  ]);
  rig.harness.fireMediaEvent(a, 'play');
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.selected()?.url, MP4, 'the visible, playing element owns the page');

  // The feed recycles: the offscreen element scrolls into place and starts playing.
  a.paused = true;
  offscreen.paused = false;
  rig.harness.setIntersection([
    { element: a, ratio: 0 },
    { element: offscreen, ratio: 0.95 },
  ]);
  rig.harness.fireMediaEvent(offscreen, 'playing');
  rig.tick();

  assert.equal(rig.selected()?.url, MP4_ALT, 'ownership must move to the element the user is watching');
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MP4_ALT);
});

test('11 — a video revealed by scroll / lazy-load is detected', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  // Lazy mount well below the fold, nothing visible yet.
  const lazy = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MP4 },
    props: { currentSrc: MP4, paused: true, videoWidth: 1280, videoHeight: 720 },
    rect: { left: 20, top: 2_000, width: 340, height: 200 },
  });
  rig.harness.setIntersection([{ element: lazy, ratio: 0 }]);
  rig.tick();
  assert.equal(rig.selected(), null, 'an offscreen preload is never the current video');

  // The user scrolls it into view and it autoplays.
  lazy.rect = PLAYER_RECT;
  lazy.paused = false;
  rig.harness.setIntersection([{ element: lazy, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(lazy, 'playing');
  rig.tick();

  assert.equal(rig.selected()?.url, MP4, `lazy video missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
});

test('stale previous-page media never publishes after a document navigation', async () => {
  const rig = createPipeline(PAGE);
  playVideo(rig, MP4);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.selected()?.url, MP4);

  rig.navigate('https://other.example.org/article');
  rig.harness.inject();
  rig.tick();

  assert.deepEqual(urls(rig), [], 'the previous page\'s media must be discarded');
  assert.equal(rig.selected(), null);
  const offer = await rig.offer();
  assert.equal(offer.ok, false);
});

test('a duplicate injection never registers a second observer set', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.harness.injectAgain();
  rig.tick();
  rig.harness.clearMessages();

  playVideo(rig, MP4);

  const batches = rig.candidates().filter((c) => c.url === MP4);
  assert.equal(batches.length, 1, 'one candidate per resource, whatever the injection count');
});

// --- Regressions for the specific defects Phase 11A fixed ---------------------------------------

test('regression — durationchange alone surfaces a resource the player attached silently', async () => {
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    rect: PLAYER_RECT,
    props: { videoWidth: 1280, videoHeight: 720 },
  });
  rig.harness.inject();
  rig.tick();

  // No attribute mutation and no loadedmetadata: the element simply starts reporting a duration.
  video.currentSrc = MP4;
  video.duration = 42;
  video.paused = false;
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'durationchange');
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `durationchange missed: ${JSON.stringify(urls(rig))}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
});

test('regression — canplay alone surfaces a resource the player attached silently', () => {
  const rig = createPipeline(PAGE);
  const video = rig.harness.appendToBody({
    tag: 'video',
    rect: PLAYER_RECT,
    props: { videoWidth: 1280, videoHeight: 720 },
  });
  rig.harness.inject();
  rig.tick();

  video.currentSrc = MP4;
  video.paused = false;
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'canplay');
  rig.tick();

  assert.ok(urls(rig).includes(MP4), `canplay missed: ${JSON.stringify(urls(rig))}`);
});

test('regression — an SPA route whose player never plays still yields a candidate', async () => {
  const rig = createPipeline(PAGE);
  const first = playVideo(rig, MP4);
  rig.harness.inject();
  rig.tick();
  assert.equal(rig.selected()?.url, MP4);

  // The new route mounts a click-to-play player that is not laid out yet: no active-video evidence at
  // all, so the mutation batch is the only carrier and it arrives before the chrome reports the route.
  rig.harness.document.body.removeChild(first);
  rig.harness.spaNavigate('https://videos.example.com/watch/def456');
  rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MP4_ALT },
    props: { currentSrc: MP4_ALT, paused: true, videoWidth: 0, videoHeight: 0 },
    rect: { left: 0, top: 0, width: 0, height: 0 },
    style: { display: 'none' },
  });
  rig.tick();

  assert.ok(urls(rig).includes(MP4_ALT), `new route media lost: ${JSON.stringify(urls(rig))}`);
  assert.ok(
    !urls(rig).includes(MP4),
    `the previous route's media must be discarded: ${JSON.stringify(urls(rig))}`,
  );
});

test('regression — detection recovers after pagehide and re-injection (back/forward restore)', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  rig.harness.fireWindowEvent('pagehide');
  rig.harness.inject(); // what react-native-webview does on the restored document
  rig.tick();

  playVideo(rig, MP4);
  assert.ok(urls(rig).includes(MP4), `dead after restore: ${JSON.stringify(urls(rig))}`);
});

test('regression — detection recovers on a bfcache pageshow with no re-injection', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  rig.harness.fireWindowEvent('pagehide');
  rig.harness.fireWindowEvent('pageshow', { persisted: true });
  rig.tick();

  playVideo(rig, MP4);
  assert.ok(urls(rig).includes(MP4), `dead after bfcache restore: ${JSON.stringify(urls(rig))}`);
});

test('regression — a burst larger than one batch delivers every candidate', () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  const burst = Array.from(
    { length: 45 },
    (_, i) => `https://cdn.example.com/media/burst-${i}.mp4`,
  );
  rig.harness.emitResourceEntries(burst.map((name) => ({ name, initiatorType: 'video' })));
  rig.tick(4_000);

  const delivered = new Set(urls(rig));
  const missing = burst.filter((url) => !delivered.has(url));
  assert.deepEqual(missing, [], 'the batch cap must defer candidates, never drop them');
});
