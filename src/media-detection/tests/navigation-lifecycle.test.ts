/**
 * In-app navigation must never leave "Video available" missing (or pointing at the previous video) until the app is
 * restarted. Every case drives the production page detector and engine through a real navigation sequence and asserts
 * the offer at the end of the live path — the video the user is looking at now, or nothing.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { mediaDetectionEngine } from '../engine/media-detection.engine';
import { useMediaDetectionStore } from '../stores';
import { isSameDocumentUrl } from '../utils/url';
import {
  createPipeline,
  mp4Everywhere,
  resetPipeline,
  restoreFetch,
  stubFetch,
  type PipelineRig,
} from './dynamic-detection-pipeline';
import { PageHarness } from './page-harness';

const SITE = 'https://videos.example.com';
const PLAYER_ORIGIN = 'https://player.example.net';
const PLAYER_RECT = { left: 20, top: 60, width: 340, height: 200 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
  mediaDetectionEngine.setRescanRequester(null);
});

/** A visible <video> playing `url`, reported to the engine. */
function playVideo(rig: PipelineRig, url: string) {
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: url },
    props: { currentSrc: url, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();
  return video;
}

/** A freshly loaded document playing `url`. */
function loadDocument(rig: PipelineRig, url: string) {
  playVideo(rig, url);
  rig.harness.inject();
  rig.tick();
}

async function offeredUrl(rig: PipelineRig): Promise<string | null> {
  const offer = await rig.offer();
  return offer.ok ? offer.url : null;
}

test('page identity: the content-selecting query is part of the page, tracking and player state are not', () => {
  assert.equal(isSameDocumentUrl(`${SITE}/watch.php?id=1`, `${SITE}/watch.php?id=2`), false);
  assert.equal(isSameDocumentUrl(`${SITE}/list?episode=3&season=1`, `${SITE}/list?season=1&episode=3`), true);
  assert.equal(
    isSameDocumentUrl(`${SITE}/watch.php?id=1`, `${SITE}/watch.php?id=1&utm_source=x&fbclid=abc&t=42#comments`),
    true,
  );
  assert.equal(isSameDocumentUrl(`${SITE}/watch/`, `https://www.videos.example.com/watch`), true);
  // Social platforms name the content in the path and decorate URLs with share parameters.
  assert.equal(
    isSameDocumentUrl(
      'https://www.instagram.com/reel/C9abcdef/?igsh=xyz',
      'https://www.instagram.com/reel/C9abcdef/?utm_source=ig_web_copy_link&foo=1',
    ),
    true,
  );
});

test('A → B through an in-page link: B is offered, nothing of A remains', async () => {
  const rig = createPipeline(`${SITE}/a.html`);
  loadDocument(rig, `${SITE}/media/a.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/a.mp4`);

  rig.linkNavigate(`${SITE}/b.html`);
  loadDocument(rig, `${SITE}/media/b.mp4`);

  assert.ok(!rig.candidates().some((c) => c.url.endsWith('/a.mp4')), 'A must be gone');
  assert.equal(await offeredUrl(rig), `${SITE}/media/b.mp4`);
});

test('several video pages in one tab, then Back and Forward: each page offers its own video', async () => {
  const pages = ['one', 'two', 'three', 'four'];
  const rig = createPipeline(`${SITE}/one.html`);
  loadDocument(rig, `${SITE}/media/one.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/one.mp4`);
  for (const name of pages.slice(1)) {
    rig.linkNavigate(`${SITE}/${name}.html`);
    loadDocument(rig, `${SITE}/media/${name}.mp4`);
    assert.equal(await offeredUrl(rig), `${SITE}/media/${name}.mp4`, `page ${name}`);
  }
  // Back and Forward are document navigations the page history drives: same tab, same navigation epoch.
  rig.linkNavigate(`${SITE}/three.html`);
  loadDocument(rig, `${SITE}/media/three.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/three.mp4`, 'back');
  rig.linkNavigate(`${SITE}/four.html`);
  loadDocument(rig, `${SITE}/media/four.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/four.mp4`, 'forward');
});

test('query-only document navigation to other content offers the new video, never the previous one', async () => {
  // Both the page and its media differ only in the query — the case that kept offering video 1 on page 3.
  const rig = createPipeline(`${SITE}/watch.php?id=1`);
  loadDocument(rig, `${SITE}/stream.mp4?id=1`);
  assert.equal(await offeredUrl(rig), `${SITE}/stream.mp4?id=1`);

  rig.linkNavigate(`${SITE}/watch.php?id=2`);
  assert.deepEqual(rig.candidates(), [], 'the previous video is not a candidate of page 2');
  loadDocument(rig, `${SITE}/stream.mp4?id=2`);
  assert.equal(await offeredUrl(rig), `${SITE}/stream.mp4?id=2`);

  rig.linkNavigate(`${SITE}/watch.php?id=3`);
  loadDocument(rig, `${SITE}/stream.mp4?id=3`);
  assert.equal(await offeredUrl(rig), `${SITE}/stream.mp4?id=3`);
});

test('SPA query-only route with the same player switching source: the offer follows the new video', async () => {
  const rig = createPipeline(`${SITE}/app?v=1`);
  const video = playVideo(rig, `${SITE}/stream.mp4?id=1`);
  rig.harness.inject();
  rig.tick();
  assert.equal(await offeredUrl(rig), `${SITE}/stream.mp4?id=1`);

  rig.harness.spaNavigate(`${SITE}/app?v=2`);
  video.setAttribute('src', `${SITE}/stream.mp4?id=2`);
  video.currentSrc = `${SITE}/stream.mp4?id=2`;
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();
  // The chrome reports the route after the page did: it must not wipe what the page already reported.
  rig.chromeSpaSync(`${SITE}/app?v=2`);
  rig.tick();

  assert.ok(!rig.candidates().some((c) => c.url.endsWith('id=1')), 'video 1 belongs to the previous route');
  assert.equal(await offeredUrl(rig), `${SITE}/stream.mp4?id=2`);
});

test('a tracking-only URL rewrite keeps the detection and the offer', async () => {
  const rig = createPipeline(`${SITE}/watch/abc123`);
  loadDocument(rig, `${SITE}/media/abc.mp4`);
  const before = rig.candidates();
  assert.equal(await offeredUrl(rig), `${SITE}/media/abc.mp4`);
  const generation = () => useMediaDetectionStore.getState().navigationEpoch;
  const epochBefore = generation();

  rig.harness.spaReplace(`${SITE}/watch/abc123?utm_source=share&fbclid=xyz#t=10`);
  rig.tick();
  rig.chromeSpaSync(`${SITE}/watch/abc123?utm_source=share&fbclid=xyz`);
  rig.tick();

  assert.equal(generation(), epochBefore);
  assert.deepEqual(
    rig.candidates().map((c) => c.id),
    before.map((c) => c.id),
    'the rewrite must not discard the candidates',
  );
  assert.equal(await offeredUrl(rig), `${SITE}/media/abc.mp4`);
});

test('reload: the reloaded document offers its video again', async () => {
  const rig = createPipeline(`${SITE}/watch/abc123`);
  loadDocument(rig, `${SITE}/media/abc.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/abc.mp4`);

  rig.reload();
  loadDocument(rig, `${SITE}/media/abc.mp4`);

  const candidate = rig.candidates().find((c) => c.url.endsWith('/abc.mp4'));
  assert.equal(candidate?.observedNavigationEpoch, rig.epoch, 'scoped to the reload, not the old document');
  assert.equal(await offeredUrl(rig), `${SITE}/media/abc.mp4`);
});

test('iframe player after navigation: a request that beats the navigation to the engine is not lost', async () => {
  const rig = createPipeline(`${SITE}/a.html`);
  loadDocument(rig, `${SITE}/media/a.mp4`);

  // The player frame of the next page requests its media while the browser's navigation for that page is still on
  // its way to the engine: the native scope already names the new page.
  rig.observeNativeRequest({
    url: `${PLAYER_ORIGIN}/media/embed-2.mp4`,
    frameUrl: `${PLAYER_ORIGIN}/embed/v2`,
    mimeType: 'video/mp4',
    pageUrlOverride: `${SITE}/embed-page.html?v=2`,
  });
  rig.linkNavigate(`${SITE}/embed-page.html?v=2`);
  rig.harness.inject();
  const iframe = rig.harness.appendToBody({
    tag: 'iframe',
    attrs: { src: `${PLAYER_ORIGIN}/embed/v2`, allowfullscreen: '' },
    rect: { left: 10, top: 40, width: 360, height: 220 },
  });
  rig.harness.setIntersection([{ element: iframe, ratio: 0.9 }]);
  rig.tick();

  assert.ok(
    rig.candidates().some((c) => c.url === `${PLAYER_ORIGIN}/media/embed-2.mp4`),
    `the frame's early request was dropped: ${JSON.stringify(rig.candidates().map((c) => c.url))}`,
  );
  assert.equal(await offeredUrl(rig), `${PLAYER_ORIGIN}/media/embed-2.mp4`);
});

test('the previous document still posting while the next one loads never erases the next page', async () => {
  const rig = createPipeline(`${SITE}/a.html`);
  loadDocument(rig, `${SITE}/media/a.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/a.mp4`);
  const departed = rig.harness;

  // A link to B. B's player fetches its file — a request only the native observer sees — while document A is still
  // alive (the WebView has not committed B yet)…
  rig.linkNavigate(`${SITE}/b.html`);
  rig.observeNativeRequest({ url: `${SITE}/media/b-file.mp4`, frameUrl: `${SITE}/b.html`, mimeType: 'video/mp4' });
  // …as does A's own player, whose request the WebView's scope already files under B (its Referer still names A)…
  rig.observeNativeRequest({ url: `${SITE}/media/a.mp4`, frameUrl: `${SITE}/a.html`, mimeType: 'video/mp4' });
  // …and A reports itself once more. It is not an SPA route back to A.
  departed.clearMessages();
  departed.runRescanScript();
  departed.advance(600);
  for (const message of departed.messages) {
    mediaDetectionEngine.handleWebViewMessage(message.raw);
  }
  assert.deepEqual(
    rig.candidates().map((c) => c.url),
    [`${SITE}/media/b-file.mp4`],
    'B keeps its own request and gets nothing of A',
  );

  // B's document reports its player: a Blob built from that file.
  rig.harness.inject();
  const blobUrl = rig.harness.createObjectUrlFor({ type: 'video/mp4' });
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: blobUrl },
    props: { currentSrc: blobUrl, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick();

  assert.equal(await offeredUrl(rig), `${SITE}/media/b-file.mp4`);
});

test('a request of the next navigation epoch waits for that navigation instead of being dropped', async () => {
  const rig = createPipeline(`${SITE}/a.html`);
  loadDocument(rig, `${SITE}/media/a.mp4`);

  rig.observeNativeRequest({
    url: `${SITE}/media/a-reloaded.mp4`,
    mimeType: 'video/mp4',
    epochOverride: rig.epoch + 1,
    pageUrlOverride: `${SITE}/a.html`,
  });
  assert.ok(!rig.candidates().some((c) => c.url.endsWith('a-reloaded.mp4')), 'not before its navigation');
  rig.reload();
  assert.ok(
    rig.candidates().some((c) => c.url.endsWith('a-reloaded.mp4')),
    'replayed once the reload reached the engine',
  );
});

test('delayed video on the next page is offered once it appears', async () => {
  const rig = createPipeline(`${SITE}/a.html`);
  loadDocument(rig, `${SITE}/media/a.mp4`);

  rig.linkNavigate(`${SITE}/delayed.html?v=2`);
  rig.harness.inject();
  rig.tick();
  assert.equal(await offeredUrl(rig), null, 'nothing yet');
  rig.tick(3_000);
  playVideo(rig, `${SITE}/media/delayed-2.mp4`);
  assert.equal(await offeredUrl(rig), `${SITE}/media/delayed-2.mp4`);
});

test('media reported while the Browser was hidden is announced again when it comes back', async () => {
  const rescans: string[] = [];
  const rig = createPipeline(`${SITE}/a.html`);
  mediaDetectionEngine.setRescanRequester((tabId) => {
    rescans.push(tabId);
    rig.harness.runRescanScript();
  });
  rig.harness.inject();
  rig.tick();

  mediaDetectionEngine.setBrowserVisible(false);
  playVideo(rig, `${SITE}/media/while-hidden.mp4`);
  assert.equal(rig.candidates().length, 0, 'the batch posted while hidden is not processed');

  mediaDetectionEngine.setBrowserVisible(true);
  rig.tick();

  assert.deepEqual(rescans, [rig.tabId]);
  assert.equal(await offeredUrl(rig), `${SITE}/media/while-hidden.mp4`);
});

test('multiple tabs: switching away and back restores the tab and asks its page to report again', async () => {
  const rescans: string[] = [];
  mediaDetectionEngine.setRescanRequester((tabId) => rescans.push(tabId));
  const rig = createPipeline(`${SITE}/embed-page.html?v=7`, { tabId: 'tab-a', epoch: 3 });
  rig.harness.inject();
  const iframe = rig.harness.appendToBody({
    tag: 'iframe',
    attrs: { src: `${PLAYER_ORIGIN}/embed/v7`, allowfullscreen: '' },
    rect: { left: 10, top: 40, width: 360, height: 220 },
  });
  rig.harness.setIntersection([{ element: iframe, ratio: 0.9 }]);
  rig.tick();
  // Network-only media: a cross-origin player's request is never re-reported by the page.
  rig.observeNativeRequest({
    url: `${PLAYER_ORIGIN}/media/embed-7.mp4`,
    frameUrl: `${PLAYER_ORIGIN}/embed/v7`,
    mimeType: 'video/mp4',
  });
  assert.equal(await offeredUrl(rig), `${PLAYER_ORIGIN}/media/embed-7.mp4`);

  // A new tab opens on its start page, then loads another page (its own epoch counter). As in the app, the active
  // tab moves first (the tab hooks run before the navigation for it reaches the engine).
  mediaDetectionEngine.setActiveTab('tab-b');
  mediaDetectionEngine.onGoHome('tab-b');
  mediaDetectionEngine.onNavigationStart(`${SITE}/other.html`, 1, 'tab-b');
  const b = new PageHarness({ url: `${SITE}/other.html` });
  const video = b.appendToBody({
    tag: 'video',
    attrs: { src: `${SITE}/media/other.mp4` },
    props: { currentSrc: `${SITE}/media/other.mp4`, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  b.setIntersection([{ element: video, ratio: 0.9 }]);
  b.fireMediaEvent(video, 'play');
  b.inject();
  b.advance(600);
  for (const message of b.messages) mediaDetectionEngine.handleWebViewMessage(message.raw);
  assert.ok(
    useMediaDetectionStore.getState().detectedMedia.every((m) => m.observedTabId === 'tab-b'),
    'tab B shows only its own media',
  );

  // Back to tab A: same page, same epoch.
  mediaDetectionEngine.setActiveTab('tab-a');
  mediaDetectionEngine.onNavigationStart(`${SITE}/embed-page.html?v=7`, 3, 'tab-a');
  assert.equal(rescans.at(-1), 'tab-a', 'tab A\'s page is asked to report again');
  assert.ok(
    rig.candidates().some((c) => c.url === `${PLAYER_ORIGIN}/media/embed-7.mp4`),
    `tab A's network-only media was lost: ${JSON.stringify(rig.candidates().map((c) => c.url))}`,
  );
  assert.equal(await offeredUrl(rig), `${PLAYER_ORIGIN}/media/embed-7.mp4`);
});
