/**
 * Phase 15A — every newly current video on a feed/reel page is detected, and only that one.
 *
 * Drives the production injected script through the real engine, correlation and verification (see
 * dynamic-detection-pipeline.ts): a recycled player moving through items with SPA routes, a virtualized feed with a
 * sponsored neighbour, a thumbnail preview that keeps playing, a parked (hidden) page, and a recycled blob/MSE player.
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
import { shouldStartVerification } from '../../browser/media-actions/cta-persistence';
import { generalPageMediaContextStore } from '../general-media/general-page-context';
import { useMediaDetectionStore } from '../stores';

const ORIGIN = 'https://reels.example.com';
const clip = (n: number) => `https://cdn.example.com/v/item-${n}.mp4`;
const PLAYER_RECT = { left: 0, top: 40, width: 390, height: 620 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
});

function mountPlayer(rig: PipelineRig, url: string): FakeElement {
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: url },
    props: { currentSrc: url, networkState: 2, paused: false, videoWidth: 720, videoHeight: 1280, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 1 }]);
  rig.harness.fireMediaEvent(video, 'play');
  return video;
}

/** What a recycled feed player does between items: drops its source (Chromium keeps currentSrc), then loads the next. */
function dropSource(rig: PipelineRig, video: FakeElement): void {
  video.removeAttribute('src');
  Object.assign(video, { networkState: 0, paused: true, videoWidth: 0, videoHeight: 0, readyState: 0 });
  rig.harness.fireMediaEvent(video, 'pause');
}

function loadSource(rig: PipelineRig, video: FakeElement, url: string): void {
  video.src = url;
  Object.assign(video, { currentSrc: url, networkState: 2, paused: false, videoWidth: 720, videoHeight: 1280, readyState: 4 });
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.harness.fireMediaEvent(video, 'play');
}

test('a recycled player never re-offers the previous item under the next route', async () => {
  const rig = createPipeline(`${ORIGIN}/reels/r1`);
  const video = mountPlayer(rig, clip(1));
  rig.harness.inject();
  rig.tick();
  const first = await rig.offer();
  assert.ok(first.ok);
  assert.equal(first.url, clip(1));

  // The page announces the next route before its player lets go of the current file.
  rig.harness.spaNavigate(`${ORIGIN}/reels/r2`);
  rig.chromeSpaSync(`${ORIGIN}/reels/r2`);
  dropSource(rig, video);
  rig.tick();
  const between = await rig.offer();
  assert.ok(!between.ok || between.url !== clip(1), `item 1 was offered on route r2: ${JSON.stringify(between)}`);

  loadSource(rig, video, clip(2));
  rig.tick();
  const second = await rig.offer();
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(second.url, clip(2));
});

test('consecutive items on one recycled player are each offered, in order', async () => {
  const rig = createPipeline(`${ORIGIN}/reels/r1`);
  const video = mountPlayer(rig, clip(1));
  rig.harness.inject();
  rig.tick();
  for (let n = 2; n <= 6; n += 1) {
    rig.harness.spaNavigate(`${ORIGIN}/reels/r${n}`);
    rig.chromeSpaSync(`${ORIGIN}/reels/r${n}`);
    dropSource(rig, video);
    rig.tick();
    loadSource(rig, video, clip(n));
    rig.tick();
    const offer = await rig.offer();
    assert.ok(offer.ok, `item ${n}: ${JSON.stringify(offer)}`);
    assert.equal(offer.url, clip(n));
  }
});

test('a sponsored neighbour in the same feed container does not mark the current post as an ad', async () => {
  const rig = createPipeline(`${ORIGIN}/feed`);
  const list = rig.harness.appendToBody({ tag: 'div', rect: { left: 0, top: 0, width: 390, height: 3000 } });
  const post = list.appendChild(
    rig.harness.createElement({ tag: 'article', attrs: { 'aria-label': 'Post 5' }, props: { innerText: 'Post 5' } }),
  );
  const sponsored = list.appendChild(
    rig.harness.createElement({ tag: 'article', attrs: { 'aria-label': 'Sponsored' }, props: { innerText: 'Sponsored' } }),
  );
  (list as unknown as { innerText: string }).innerText = 'Post 5\nSponsored';
  const current = post.appendChild(
    rig.harness.createElement({
      tag: 'video',
      attrs: { src: clip(5) },
      props: { currentSrc: clip(5), networkState: 2, paused: false, videoWidth: 720, videoHeight: 1280, readyState: 4 },
      rect: PLAYER_RECT,
    }),
  );
  sponsored.appendChild(
    rig.harness.createElement({
      tag: 'video',
      attrs: { src: 'https://cdn.example.com/ads/spot.mp4' },
      props: { currentSrc: 'https://cdn.example.com/ads/spot.mp4', networkState: 1, paused: true, videoWidth: 720, videoHeight: 1280 },
      rect: { left: 0, top: 900, width: 390, height: 620 },
    }),
  );
  rig.harness.inject();
  rig.harness.setIntersection([{ element: current, ratio: 1 }]);
  rig.harness.fireMediaEvent(current, 'play');
  rig.tick();

  const offer = await rig.offer();
  assert.ok(offer.ok, JSON.stringify(offer));
  assert.equal(offer.url, clip(5));
});

test('a full-resolution video drawn as a thumbnail preview is never offered as the current video', async () => {
  const rig = createPipeline(`${ORIGIN}/feed`);
  const preview = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: 'https://cdn.example.com/v/suggested.mp4', muted: '' },
    props: {
      currentSrc: 'https://cdn.example.com/v/suggested.mp4',
      networkState: 2,
      paused: false,
      muted: true,
      videoWidth: 1280,
      videoHeight: 720,
      readyState: 4,
    },
    rect: { left: 4, top: 4, width: 120, height: 68 },
  });
  rig.harness.inject();
  rig.harness.setIntersection([{ element: preview, ratio: 1 }]);
  rig.harness.fireMediaEvent(preview, 'play');
  rig.tick();

  const offer = await rig.offer();
  assert.ok(!offer.ok, `the preview was offered: ${JSON.stringify(offer)}`);
});

test('a hidden (parked) page posts nothing, and reports what it shows once visible again', async () => {
  const rig = createPipeline(`${ORIGIN}/reels/r1`);
  const video = mountPlayer(rig, clip(1));
  rig.harness.inject();
  rig.tick();

  rig.harness.setVisibility('hidden');
  rig.harness.clearMessages();
  // While parked the page moves on by itself (an autoplay feed).
  rig.harness.spaNavigate(`${ORIGIN}/reels/r2`);
  dropSource(rig, video);
  loadSource(rig, video, clip(2));
  rig.harness.advance(2_000);
  assert.deepEqual(rig.harness.messages.map((m) => m.type), [], 'a hidden page must not post');

  rig.chromeSpaSync(`${ORIGIN}/reels/r2`);
  rig.harness.setVisibility('visible');
  rig.tick();
  const offer = await rig.offer();
  assert.ok(offer.ok, JSON.stringify(offer));
  assert.equal(offer.url, clip(2));
});

test('a recycled blob/MSE player offers the source its library requested just before attaching it', async () => {
  const rig = createPipeline(`${ORIGIN}/mse`);
  rig.harness.inject();
  const video = rig.harness.appendToBody({ tag: 'video', rect: PLAYER_RECT });
  const attach = (source: string) => {
    rig.observeNativeRequest({ url: source, frameUrl: `${ORIGIN}/mse`, mimeType: 'video/mp4' });
    rig.pump();
    const blob = rig.harness.createObjectUrlFor({ addSourceBuffer: () => ({}) });
    video.src = blob;
    Object.assign(video, { currentSrc: blob, networkState: 2, paused: false, videoWidth: 720, videoHeight: 1280, readyState: 4 });
    rig.harness.setIntersection([{ element: video, ratio: 1 }]);
    rig.harness.fireMediaEvent(video, 'loadstart');
    rig.harness.fireMediaEvent(video, 'play');
    rig.tick();
  };

  attach(clip(1));
  const first = await rig.offer();
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.url, clip(1));

  attach(clip(2));
  const second = await rig.offer();
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(second.url, clip(2));
});

/**
 * A reel viewer that opens on a link naming one video (`/watch/?v=<id>`) and then scrolls through other reels without
 * ever changing its address: the URL's id names the first reel only. Each reel must be its own current media — the
 * previous reel's offer never stands for the next one — and scrolling back returns to the first reel's identity.
 */
const VIEWER = 'https://social.example.com/watch/?v=4678791569058145&vanity=61590907390583';
const VIEWPORT_H = 664;

function mountReel(rig: PipelineRig, index: number, url: string | null): FakeElement {
  return rig.harness.appendToBody({
    tag: 'video',
    attrs: url ? { src: url } : {},
    props: url
      ? { currentSrc: url, networkState: 1, paused: true, videoWidth: 720, videoHeight: 1280, readyState: 1 }
      : { currentSrc: '', networkState: 0, paused: true, videoWidth: 0, videoHeight: 0, readyState: 0 },
    rect: { left: 0, top: index * VIEWPORT_H, width: 390, height: VIEWPORT_H },
  });
}

/** Scroll the viewer so `reels[index]` fills the screen: it plays, every other reel pauses. */
function scrollToReel(rig: PipelineRig, reels: FakeElement[], index: number, url: string): void {
  reels.forEach((reel, i) => {
    reel.rect = { ...reel.rect, top: (i - index) * VIEWPORT_H };
  });
  const current = reels[index]!;
  for (const [i, reel] of reels.entries()) {
    if (i !== index && !(reel as unknown as { paused: boolean }).paused) {
      Object.assign(reel, { paused: true });
      rig.harness.fireMediaEvent(reel, 'pause');
    }
  }
  if (!(current as unknown as { currentSrc: string }).currentSrc) {
    current.src = url;
  }
  Object.assign(current, { currentSrc: url, networkState: 2, paused: false, videoWidth: 720, videoHeight: 1280, readyState: 4 });
  rig.harness.setIntersection(reels.map((reel, i) => ({ element: reel, ratio: i === index ? 1 : 0 })));
  rig.harness.fireMediaEvent(current, 'play');
  rig.tick();
}

function liveIdentity(rig: PipelineRig): string | null {
  return generalPageMediaContextStore.get(rig.tabId)?.currentMediaIdentity ?? null;
}

test('a reel viewer that keeps one URL gives every reel its own identity and offer, and the first back on return', async () => {
  const rig = createPipeline(VIEWER);
  const reels = [1, 2, 3, 4].map((n, i) => mountReel(rig, i, i < 2 ? clip(n) : null));
  rig.harness.inject();
  scrollToReel(rig, reels, 0, clip(1));
  const first = await rig.offer();
  assert.ok(first.ok, JSON.stringify(first));
  assert.equal(first.url, clip(1));
  const firstIdentity = liveIdentity(rig);
  assert.equal(firstIdentity, 'video:4678791569058145');

  const seen = new Set([firstIdentity]);
  for (let n = 2; n <= 4; n += 1) {
    scrollToReel(rig, reels, n - 1, clip(n));
    const identity = liveIdentity(rig);
    assert.ok(identity && !seen.has(identity), `reel ${n} kept a previous identity: ${identity}`);
    seen.add(identity);
    // The standing offer of the previous reel can no longer be kept as "the same content".
    assert.equal(
      shouldStartVerification({
        status: 'verified',
        offerContentIdentity: [...seen][n - 2]!,
        nextContentIdentity: identity,
        verifiedCandidateId: null,
        nextCandidateId: null,
      }),
      true,
    );
    const offer = await rig.offer();
    assert.ok(offer.ok, `reel ${n}: ${JSON.stringify(offer)}`);
    assert.equal(offer.url, clip(n));
  }

  // Scroll back to the first reel: the URL's id names it again.
  scrollToReel(rig, reels, 0, clip(1));
  assert.equal(liveIdentity(rig), firstIdentity);
  const back = await rig.offer();
  assert.ok(back.ok, JSON.stringify(back));
  assert.equal(back.url, clip(1));
});

test('one recycled player under a URL naming a video id: the next file is never the first video', async () => {
  const rig = createPipeline(VIEWER);
  const video = mountPlayer(rig, clip(1));
  rig.harness.inject();
  rig.tick();
  const firstIdentity = liveIdentity(rig);
  assert.equal(firstIdentity, 'video:4678791569058145');

  for (let n = 2; n <= 4; n += 1) {
    dropSource(rig, video);
    rig.tick();
    assert.notEqual(liveIdentity(rig), firstIdentity, `item ${n}: an empty player kept the first video's identity`);
    loadSource(rig, video, clip(n));
    rig.tick();
    assert.notEqual(liveIdentity(rig), firstIdentity);
    const offer = await rig.offer();
    assert.ok(offer.ok, `item ${n}: ${JSON.stringify(offer)}`);
    assert.equal(offer.url, clip(n));
  }
});

test('the item still playing when the URL switches to the next id does not take that id', async () => {
  const rig = createPipeline(`${ORIGIN}/watch/?v=item000001`);
  const video = mountPlayer(rig, clip(1));
  rig.harness.inject();
  rig.tick();
  assert.equal(liveIdentity(rig), 'video:item000001');

  // The page announces the next item's route while its player still shows item 1.
  rig.harness.spaNavigate(`${ORIGIN}/watch/?v=item000002`);
  rig.chromeSpaSync(`${ORIGIN}/watch/?v=item000002`);
  rig.harness.fireMediaEvent(video, 'timeupdate');
  rig.tick();
  assert.notEqual(liveIdentity(rig), 'video:item000002', 'item 1 was named by item 2\'s id');

  dropSource(rig, video);
  loadSource(rig, video, clip(2));
  rig.tick();
  assert.equal(liveIdentity(rig), 'video:item000002');
  const offer = await rig.offer();
  assert.ok(offer.ok, JSON.stringify(offer));
  assert.equal(offer.url, clip(2));
});

test('a reel scrolled back to minutes later is offered again though the page never re-requests its signed file', async () => {
  const signed = (n: number) => `${clip(n)}?_nc_cat=1&oh=00_sig${n}&oe=68DD5A2B`;
  const rig = createPipeline(VIEWER);
  const reels = [1, 2].map((n, i) => mountReel(rig, i, signed(n)));
  rig.harness.inject();
  for (const n of [1, 2]) {
    rig.observeNativeRequest({ url: signed(n), mimeType: 'video/mp4' });
  }
  scrollToReel(rig, reels, 0, signed(1));
  assert.ok((await rig.offer()).ok);
  scrollToReel(rig, reels, 1, signed(2));
  assert.ok((await rig.offer()).ok);

  // Minutes pass on reel 2; the page replays reel 1 from its cache when the user scrolls back — no new request.
  const store = useMediaDetectionStore.getState();
  useMediaDetectionStore.setState({
    detectedMedia: store.detectedMedia.map((m) => ({ ...m, detectedAt: m.detectedAt - 10 * 60_000 })),
  });
  scrollToReel(rig, reels, 0, signed(1));
  const back = await rig.offer();
  assert.ok(back.ok, `reel 1 after scrolling back: ${JSON.stringify(back)}`);
  assert.equal(back.url, signed(1));
});
