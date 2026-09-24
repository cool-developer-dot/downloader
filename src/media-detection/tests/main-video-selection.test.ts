/**
 * Phase 11C — the offer must be the video the user is watching, not an ad or another player.
 *
 * Every case drives the production injected script through the real engine, correlation and verification,
 * and asserts the *published offer* — not just which candidate correlation liked.
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
const AD = 'https://ads.example.net/preroll/spot-1.mp4';
const MAIN = 'https://cdn.example.com/media/main-720p.mp4';
const SECOND = 'https://cdn.example.com/media/second-1080p.mp4';
const MAIN_RECT = { left: 0, top: 40, width: 380, height: 220 };
const THUMBNAIL_RECT = { left: 20, top: 900, width: 120, height: 70 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
});

function mountPlaying(rig: PipelineRig, url: string, rect = MAIN_RECT, props: Record<string, unknown> = {}) {
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: url },
    props: { currentSrc: url, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4, ...props },
    rect,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  return video;
}

test('1 — a preroll ad in the player is replaced by the main video in the offer', async () => {
  const rig = createPipeline(PAGE);
  const player = mountPlaying(rig, AD);
  rig.harness.inject();
  rig.tick();

  const duringAd = await rig.offer();
  assert.ok(duringAd.ok, 'the ad is what is playing, so it is what is offered while it plays');
  assert.equal(duringAd.url, AD);

  // The ad ends and the same element switches to the feature.
  player.src = MAIN;
  player.currentSrc = MAIN;
  rig.harness.fireMediaEvent(player, 'loadedmetadata');
  rig.harness.fireMediaEvent(player, 'playing');
  rig.tick();

  assert.equal(rig.selected()?.url, MAIN, 'ownership follows the element to the feature');
  const afterAd = await rig.offer();
  assert.ok(afterAd.ok, `expected an offer, got ${JSON.stringify(afterAd)}`);
  assert.equal(afterAd.url, MAIN, 'the ad must not remain the offered source');
});

test('2 — a larger second video on the page never outranks the one being watched', async () => {
  const rig = createPipeline(PAGE);
  const watching = mountPlaying(rig, MAIN);
  // A bigger, higher-quality clip sits further down the page, paused and out of view.
  const offscreen = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: SECOND },
    props: { currentSrc: SECOND, paused: true, videoWidth: 1920, videoHeight: 1080 },
    rect: THUMBNAIL_RECT,
  });
  rig.harness.inject();
  rig.harness.setIntersection([
    { element: watching, ratio: 0.95 },
    { element: offscreen, ratio: 0 },
  ]);
  rig.harness.fireMediaEvent(watching, 'play');
  rig.tick();

  assert.equal(rig.selected()?.url, MAIN);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MAIN, 'size must never beat ownership');
});

test('3 — an explicitly marked advertisement is never the offered media', async () => {
  const rig = createPipeline(PAGE);
  rig.harness.inject();
  rig.tick();

  const adSlot = rig.harness.appendToBody({
    tag: 'div',
    attrs: { 'data-ad': 'true', 'aria-label': 'Advertisement' },
    rect: MAIN_RECT,
  });
  const adVideo = rig.harness.createElement({
    tag: 'video',
    attrs: { src: AD },
    props: { currentSrc: AD, paused: false, videoWidth: 1280, videoHeight: 720 },
    rect: MAIN_RECT,
  });
  adSlot.appendChild(adVideo);
  rig.harness.setIntersection([{ element: adVideo, ratio: 0.95 }]);
  rig.harness.fireMediaEvent(adVideo, 'play');
  rig.tick();

  assert.equal(rig.selected(), null, 'a marked ad owns nothing');
  const offer = await rig.offer();
  assert.equal(offer.ok, false, 'an advertisement is never offered for download');
});

test('4 — when the watched video and an ad are both candidates, the watched one is offered', async () => {
  const rig = createPipeline(PAGE);
  const player = mountPlaying(rig, MAIN);
  rig.harness.inject();
  rig.tick();

  // The ad request lands afterwards, from the same page, as a plain network observation.
  rig.observeNativeRequest({ url: AD, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.harness.fireMediaEvent(player, 'playing');
  rig.tick();

  const urls = rig.candidates().map((c) => c.url);
  assert.ok(urls.includes(MAIN) && urls.includes(AD), `expected both candidates, got ${JSON.stringify(urls)}`);
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MAIN);
});

test('5 — previous SPA route media is never offered for the new route', async () => {
  const rig = createPipeline(PAGE);
  const first = mountPlaying(rig, MAIN);
  rig.harness.inject();
  rig.tick();
  assert.equal((await rig.offer()).ok, true);

  rig.harness.document.body.removeChild(first);
  rig.harness.spaNavigate('https://videos.example.com/watch/def456');
  mountPlaying(rig, SECOND);
  rig.tick();

  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, SECOND, 'the previous route\'s media must not survive into the new one');
});

test('6 — a tiny muted preview loop is not offered while a real player is on the page', async () => {
  const rig = createPipeline(PAGE);
  const main = mountPlaying(rig, MAIN);
  const preview = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: SECOND },
    props: { currentSrc: SECOND, paused: false, muted: true, videoWidth: 120, videoHeight: 68 },
    rect: { left: 240, top: 60, width: 110, height: 62 },
  });
  rig.harness.inject();
  rig.harness.setIntersection([
    { element: main, ratio: 0.95 },
    { element: preview, ratio: 0.9 },
  ]);
  rig.harness.fireMediaEvent(main, 'play');
  rig.tick();

  const offer = await rig.offer();
  assert.ok(offer.ok, `expected an offer, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MAIN, 'a card preview never wins over the main player');
});

test('7 — a preroll ad in its own element over the paused player: the main video is offered once it plays', async () => {
  const rig = createPipeline(PAGE);
  // The page's player is loaded (metadata only) and paused behind an ad element that plays first.
  const main = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: MAIN, preload: 'metadata' },
    props: { currentSrc: MAIN, paused: true, videoWidth: 1280, videoHeight: 720, readyState: 1 },
    rect: MAIN_RECT,
  });
  const ad = mountPlaying(rig, AD);
  rig.harness.setIntersection([
    { element: main, ratio: 0.9 },
    { element: ad, ratio: 0.9 },
  ]);
  rig.harness.inject();
  rig.tick();
  // Both files were requested while the ad played: the player's metadata and the ad itself.
  rig.observeNativeRequest({ url: MAIN, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.observeNativeRequest({ url: AD, frameUrl: PAGE, mimeType: 'video/mp4' });
  rig.tick();

  // The ad ends: its element is removed and the page starts its own player, whose file was requested long ago.
  main.parentElement?.removeChild(ad);
  (ad as unknown as { paused: boolean }).paused = true;
  main.paused = false;
  main.readyState = 4;
  rig.harness.fireMediaEvent(main, 'play');
  rig.harness.fireMediaEvent(main, 'playing');
  rig.tick();

  assert.equal(rig.selected()?.url, MAIN, 'ownership moves to the player the user now watches');
  const offer = await rig.offer();
  assert.ok(offer.ok, `expected the main video to be offered, got ${JSON.stringify(offer)}`);
  assert.equal(offer.url, MAIN);
});
