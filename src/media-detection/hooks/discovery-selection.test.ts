import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { generalPageMediaContextStore } from '../general-media/general-page-context';
import { mediaDetectionPipeline } from '../services/detection.service';
import type { DetectedMedia } from '../types';
import { buildOwnershipKey, selectDiscoveryMedia, subscribeOwnership } from './discovery-selection';

const TAB = 'tab-1';
const PAGE = 'https://news.example.org/story/42';

function networkCandidate(url: string, referer: string): DetectedMedia {
  const media = mediaDetectionPipeline.processNetworkUrl([], url, PAGE, [], {
    detectionSource: 'native_network',
    hasRange: true,
    isForMainFrame: false,
  }).media[0];
  assert.ok(media);
  return {
    ...media,
    frameUrl: referer,
    observedTabId: TAB,
    observedNavigationEpoch: 0,
    observedPageGeneration: generalPageMediaContextStore.get(TAB)?.pageGeneration,
  };
}

function playing(src: string, options: { element?: string; ratio?: number; paused?: boolean } = {}): void {
  generalPageMediaContextStore.applyActiveVideoEvidence({
    tabId: TAB,
    navigationEpoch: 0,
    evidence: {
      pageUrl: PAGE,
      elementIdentity: options.element ?? 'video:0',
      currentSrc: src,
      src,
      isBlob: false,
      paused: options.paused ?? false,
      ended: false,
      readyState: 4,
      videoWidth: 640,
      videoHeight: 360,
      muted: false,
      currentTimeBucket: 1,
      intersectionRatio: options.ratio ?? 1,
      viewportCenterDistance: 0,
      isDisplayed: true,
      isVisibleStyle: true,
      recentlyPlayed: !(options.paused ?? false),
      explicitAdMarker: false,
      associatedContentId: null,
      observedAt: Date.now(),
    },
  });
}

function select(candidates: DetectedMedia[]): DetectedMedia | null {
  return selectDiscoveryMedia({
    candidates,
    focusedMediaId: null,
    lastNavigation: PAGE,
    activeTabId: TAB,
    navigationEpoch: 0,
    ownershipKey: buildOwnershipKey(TAB),
    msePlaybackActive: false,
    msePlaybackAgeMs: null,
  });
}

beforeEach(() => {
  generalPageMediaContextStore.clearAll();
  generalPageMediaContextStore.setActiveTab(TAB);
  generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: PAGE, navigationEpoch: 0 });
});

describe('ownership key', () => {
  test('ignores intersection noise but changes when the owner becomes STRONG or the player switches', () => {
    playing('https://media.example.org/v/a?sig=1', { ratio: 0.3, paused: true });
    const medium = buildOwnershipKey(TAB);
    playing('https://media.example.org/v/a?sig=1', { ratio: 0.32, paused: true });
    assert.equal(buildOwnershipKey(TAB), medium, 'small visibility changes are not ownership transitions');

    playing('https://media.example.org/v/a?sig=2', { ratio: 0.9, paused: false });
    const strong = buildOwnershipKey(TAB);
    assert.notEqual(strong, medium, 'MEDIUM → STRONG (now playing) must wake selection');

    playing('https://media.example.org/v/b?sig=3', { ratio: 0.9, element: 'video:1' });
    assert.notEqual(buildOwnershipKey(TAB), strong, 'visible player switch must wake selection');
  });

  test('visibility becoming known (or the video leaving the viewport) is an ownership transition; jitter is not', () => {
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE, elementIdentity: 'video:0', currentSrc: 'https://media.example.org/v/a?sig=1',
        src: 'https://media.example.org/v/a?sig=1', isBlob: false, paused: true, ended: false, readyState: 1,
        videoWidth: 640, videoHeight: 360, muted: false, currentTimeBucket: 0, intersectionRatio: null,
        viewportCenterDistance: null, isDisplayed: true, isVisibleStyle: true, recentlyPlayed: false,
        explicitAdMarker: false, associatedContentId: null, observedAt: Date.now(),
      },
    });
    const unknown = buildOwnershipKey(TAB);
    playing('https://media.example.org/v/a?sig=1', { ratio: 0.9, paused: true });
    const visible = buildOwnershipKey(TAB);
    assert.notEqual(visible, unknown);
    playing('https://media.example.org/v/a?sig=1', { ratio: 0.95, paused: true });
    assert.equal(buildOwnershipKey(TAB), visible);
    playing('https://media.example.org/v/a?sig=1', { ratio: 0, paused: true });
    assert.notEqual(buildOwnershipKey(TAB), visible);
  });

  test('signed URL rotation of the same active resource is not an ownership transition', () => {
    playing('https://media.example.org/v/a?token=one&expires=1');
    const before = buildOwnershipKey(TAB);
    playing('https://media.example.org/v/a?token=two&expires=2');
    assert.equal(buildOwnershipKey(TAB), before);
  });

  test('store updates notify subscribers once, after the updating task (never inside a render)', async () => {
    let calls = 0;
    const unsubscribe = subscribeOwnership(() => {
      calls += 1;
    });
    playing('https://media.example.org/v/a?sig=1');
    playing('https://media.example.org/v/b?sig=2', { element: 'video:1' });
    assert.equal(calls, 0, 'no synchronous delivery');
    await Promise.resolve();
    unsubscribe();
    assert.equal(calls, 1, 'coalesced into one delivery');
  });
});

describe('selection follows ownership without a new candidate (B)', () => {
  test('a preloaded candidate is selected once its video becomes the playing owner', () => {
    playing('https://media.example.org/v/current?sig=1');
    const preload = networkCandidate('https://media.example.org/v/next?sig=2', 'https://news.example.org/');
    assert.equal(select([preload]), null, 'offscreen preload while another video plays');

    playing('https://media.example.org/v/next?sig=5', { element: 'video:1' });
    assert.equal(select([preload])?.id, preload.id);
  });
});

describe('no resurrection of ownership-rejected media (F)', () => {
  test('media owned by another frame is never offered through a fallback', () => {
    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE,
        iframeIdentity: 'iframe:0',
        iframeSrc: 'https://player.embedhost.io/embed/zz91',
        frameClass: 'cross-origin',
        isDisplayed: true,
        isVisibleStyle: true,
        intersectionRatio: 1,
        width: 347,
        height: 230,
        allowFullscreen: true,
        allow: null,
        looksPlayer: true,
        sameOriginVideoCount: 0,
      },
    });
    const adMedia = networkCandidate('https://edge7.cdnhost.net/o/7c1e55?token=x', 'https://ads.adnetwork.example/');
    assert.equal(select([adMedia]), null);
  });

  test('an offscreen preload is never offered through a fallback', () => {
    playing('https://media.example.org/v/current?sig=1');
    const preload = networkCandidate('https://media.example.org/v/next?sig=2', 'https://news.example.org/');
    assert.equal(select([preload]), null);
  });
});
