/**
 * An SPA names its new route after pushState returns (after rendering, often after a fetch). The video of the new
 * route must carry the new route's name — never the previous route's, which is what the page still showed while
 * `history.pushState` ran.
 */
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { mediaDetectionEngine } from '../engine/media-detection.engine';
import { useMediaDetectionStore } from '../stores';
import { createPipeline, mp4Everywhere, resetPipeline, restoreFetch, stubFetch } from './dynamic-detection-pipeline';

const SITE = 'https://videos.example.com';
const PLAYER_RECT = { left: 20, top: 60, width: 340, height: 200 };

beforeEach(() => {
  stubFetch(mp4Everywhere());
});

afterEach(() => {
  restoreFetch();
  resetPipeline();
  mediaDetectionEngine.setRescanRequester(null);
});

test('route change: the new route video is named after the new route', async () => {
  const rig = createPipeline(`${SITE}/app/first`, { title: 'First clip' });
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: `${SITE}/m/first.mp4` },
    props: { currentSrc: `${SITE}/m/first.mp4`, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.inject();
  rig.tick();

  rig.harness.spaNavigate(`${SITE}/app/second`);
  // The WebView requests the new source as soon as the player switches to it.
  rig.observeNativeRequest({ url: `${SITE}/m/second.mp4`, mimeType: 'video/mp4' });
  video.setAttribute('src', `${SITE}/m/second.mp4`);
  video.currentSrc = `${SITE}/m/second.mp4`;
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.document.title = 'Second clip';
  rig.tick(3_000);
  rig.chromeSpaSync(`${SITE}/app/second`);
  rig.tick(3_000);

  const second = rig.candidates().find((media) => media.url === `${SITE}/m/second.mp4`);
  assert.equal(second?.title, 'Second clip');
  assert.equal(useMediaDetectionStore.getState().pageMetadata?.title, 'Second clip');
});

test('routes that share one title keep it, and a route that never renames itself is left alone', async () => {
  const rig = createPipeline(`${SITE}/app/first`, { title: 'Clips' });
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: `${SITE}/m/first.mp4` },
    props: { currentSrc: `${SITE}/m/first.mp4`, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.inject();
  rig.tick();

  rig.harness.spaNavigate(`${SITE}/app/second`);
  video.setAttribute('src', `${SITE}/m/second.mp4`);
  video.currentSrc = `${SITE}/m/second.mp4`;
  rig.harness.fireMediaEvent(video, 'loadstart');
  rig.harness.fireMediaEvent(video, 'play');
  rig.tick(4_000);

  assert.equal(rig.candidates().find((media) => media.url === `${SITE}/m/second.mp4`)?.title, 'Clips');
  assert.equal(useMediaDetectionStore.getState().pageMetadata?.title, 'Clips');
});

test('a title change on another page never renames this one', async () => {
  const rig = createPipeline(`${SITE}/app/first`, { title: 'First clip' });
  const video = rig.harness.appendToBody({
    tag: 'video',
    attrs: { src: `${SITE}/m/first.mp4` },
    props: { currentSrc: `${SITE}/m/first.mp4`, paused: false, videoWidth: 1280, videoHeight: 720, readyState: 4 },
    rect: PLAYER_RECT,
  });
  rig.harness.setIntersection([{ element: video, ratio: 0.9 }]);
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.inject();
  rig.tick();

  rig.harness.spaNavigate(`${SITE}/app/second`);
  video.setAttribute('src', `${SITE}/m/second.mp4`);
  video.currentSrc = `${SITE}/m/second.mp4`;
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.document.title = 'Second clip';
  rig.tick(1_000);

  rig.harness.spaNavigate(`${SITE}/app/third`);
  video.setAttribute('src', `${SITE}/m/third.mp4`);
  video.currentSrc = `${SITE}/m/third.mp4`;
  rig.harness.fireMediaEvent(video, 'play');
  rig.harness.document.title = 'Third clip';
  rig.tick(1_000);

  assert.equal(rig.candidates().find((media) => media.url === `${SITE}/m/third.mp4`)?.title, 'Third clip');
  assert.equal(useMediaDetectionStore.getState().pageMetadata?.title, 'Third clip');
  assert.ok(
    !rig.candidates().some((media) => media.url === `${SITE}/m/third.mp4` && media.title === 'Second clip'),
  );
});
