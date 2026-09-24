import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { selectCurrentGeneralMedia } from '../general-media/general-correlation.service';
import { generalPageMediaContextStore } from '../general-media/general-page-context';
import type { DetectedMedia, MediaObservationStamp } from '../types';
import { mediaDetectionPipeline } from './detection.service';

const TAB = 'tab-1';
const PAGE = 'https://news.example.org/story/42';
const CDN = 'https://edge7.cdnhost.net/o/9f3a1c';

function observe(existing: DetectedMedia[], url: string, observation?: MediaObservationStamp): DetectedMedia[] {
  return mediaDetectionPipeline.processNetworkUrl(existing, url, PAGE, [], {
    detectionSource: 'native_network',
    hasRange: true,
    isForMainFrame: false,
    observation,
  }).media;
}

function stamp(epoch: number, generation: number): MediaObservationStamp {
  return {
    frameUrl: 'https://news.example.org/',
    observedTabId: TAB,
    observedNavigationEpoch: epoch,
    observedPageGeneration: generation,
  };
}

beforeEach(() => {
  generalPageMediaContextStore.clearAll();
  generalPageMediaContextStore.setActiveTab(TAB);
});

describe('re-observation moves a candidate to the scope it was just seen in', () => {
  test('after a reload the same resource with a rotated signed URL carries the new epoch and generation', () => {
    const before = observe([], `${CDN}?token=aaa&expires=4102444800`, stamp(2, 1));
    const after = observe(before, `${CDN}?token=bbb&expires=4102444900`, stamp(3, 4));
    assert.equal(after.length, 1, 'rotation collapses into one candidate');
    assert.equal(after[0]?.observedNavigationEpoch, 3);
    assert.equal(after[0]?.observedPageGeneration, 4);
  });

  test('pipeline work without an observation (enrichment, page script) never freshens an old candidate', () => {
    const before = observe([], `${CDN}?token=aaa&expires=4102444800`, stamp(2, 1));
    const after = observe(before, `${CDN}?token=bbb&expires=4102444900`);
    assert.equal(after[0]?.observedNavigationEpoch, 2);
    assert.equal(after[0]?.observedPageGeneration, 1);
  });

  test('the re-observed resource is selectable in the new navigation; the stale record is not', () => {
    generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: PAGE, navigationEpoch: 3 });
    const src = `${CDN}?token=ccc&expires=4102445000`;
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: TAB,
      navigationEpoch: 3,
      evidence: {
        pageUrl: PAGE, elementIdentity: 'video:0', currentSrc: src, src, isBlob: false, paused: false, ended: false,
        readyState: 4, videoWidth: 640, videoHeight: 360, muted: false, currentTimeBucket: 1, intersectionRatio: 1,
        viewportCenterDistance: 0, isDisplayed: true, isVisibleStyle: true, recentlyPlayed: true,
        explicitAdMarker: false, associatedContentId: null, observedAt: Date.now(),
      },
    });
    const context = generalPageMediaContextStore.get(TAB);
    const select = (candidates: DetectedMedia[]) =>
      selectCurrentGeneralMedia({
        candidates,
        context,
        tabId: TAB,
        navigationEpoch: 3,
        pageGeneration: context?.pageGeneration,
        pageUrl: PAGE,
      });
    const stale = observe([], `${CDN}?token=aaa&expires=4102444800`, stamp(2, 1));
    assert.equal(select(stale).media, null);
    assert.equal(select(stale).group.rejected[0]?.reason, 'STALE_NAVIGATION');

    const current = observe(stale, `${CDN}?token=bbb&expires=4102444900`, stamp(3, context?.pageGeneration ?? 0));
    assert.equal(select(current).media?.id, stale[0]?.id);
  });
});
