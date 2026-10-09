import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { mediaDetectionPipeline } from '../services/detection.service';
import type { DetectedMedia } from '../types';
import {
  isOfferedSourceRejectedNow,
  resolveGeneralRequestProvenance,
  selectCurrentGeneralMedia,
} from './general-correlation.service';
import { generalPageMediaContextStore } from './general-page-context';

const TAB = 'tab-1';
const PAGE = 'https://news.example.org/story/42';
const PLAYER_SRC = 'https://player.embedhost.io/embed/zz91?autoplay=0';
const CDN = 'https://edge7.cdnhost.net/o/9f3a1c';

/** A network candidate exactly as the engine stores it: classified by the real pipeline, then scoped. */
function networkCandidate(
  url: string,
  options: { referer?: string | null; generation?: number; existing?: DetectedMedia[] } = {},
): DetectedMedia {
  const result = mediaDetectionPipeline.processNetworkUrl(options.existing ?? [], url, PAGE, [], {
    detectionSource: 'native_network',
    hasRange: true,
    isForMainFrame: false,
    mimeType: null,
  });
  const media = result.media.find((item) => item.url === url) ?? result.media[0];
  assert.ok(media, `pipeline rejected ${url}`);
  return {
    ...media,
    frameUrl: options.referer === undefined ? 'https://player.embedhost.io/' : options.referer,
    observedTabId: TAB,
    observedNavigationEpoch: 0,
    observedPageGeneration: options.generation ?? generalPageMediaContextStore.get(TAB)?.pageGeneration,
  };
}

function iframeOwner(): void {
  generalPageMediaContextStore.applyActiveIframePlayerEvidence({
    tabId: TAB,
    navigationEpoch: 0,
    evidence: {
      pageUrl: PAGE,
      iframeIdentity: 'iframe:0',
      iframeSrc: PLAYER_SRC,
      frameClass: 'cross-origin',
      isDisplayed: true,
      isVisibleStyle: true,
      intersectionRatio: 1,
      width: 347,
      height: 230,
      allowFullscreen: true,
      allow: 'autoplay; fullscreen',
      looksPlayer: true,
      sameOriginVideoCount: 0,
    },
  });
}

function videoOwner(input: {
  src: string;
  paused: boolean;
  intersectionRatio: number;
  element?: string;
  isBlob?: boolean;
  width?: number;
  height?: number;
  muted?: boolean;
}): void {
  generalPageMediaContextStore.applyActiveVideoEvidence({
    tabId: TAB,
    navigationEpoch: 0,
    evidence: {
      pageUrl: PAGE,
      elementIdentity: input.element ?? 'video:0',
      currentSrc: input.src,
      src: input.src,
      isBlob: input.isBlob ?? input.src.startsWith('blob:'),
      paused: input.paused,
      ended: false,
      readyState: 4,
      videoWidth: input.width ?? 640,
      videoHeight: input.height ?? 360,
      muted: input.muted ?? false,
      currentTimeBucket: 1,
      intersectionRatio: input.intersectionRatio,
      viewportCenterDistance: 0,
      isDisplayed: true,
      isVisibleStyle: true,
      recentlyPlayed: !input.paused,
      explicitAdMarker: false,
      associatedContentId: null,
      observedAt: Date.now(),
    },
  });
}

function select(candidates: DetectedMedia[]) {
  const context = generalPageMediaContextStore.get(TAB);
  return selectCurrentGeneralMedia({
    candidates,
    context,
    tabId: TAB,
    navigationEpoch: 0,
    pageGeneration: context?.pageGeneration,
    pageUrl: PAGE,
  });
}

beforeEach(() => {
  generalPageMediaContextStore.clearAll();
  generalPageMediaContextStore.setActiveTab(TAB);
  generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: PAGE, navigationEpoch: 0 });
});

describe('cross-origin iframe → unrelated CDN ownership (C/D)', () => {
  test('page A → iframe B → CDN C with origin-only Referer is owned by the player', () => {
    iframeOwner();
    const media = networkCandidate(`${CDN}?token=abc&expires=4102444800`);
    const picked = select([media]);
    assert.equal(picked.media?.id, media.id);
    assert.notEqual(picked.group.confidence, 'REJECTED');
    assert.ok(picked.group.confidence === 'MEDIUM' || picked.group.confidence === 'STRONG');
  });

  test('full iframe document Referer is also the player frame', () => {
    iframeOwner();
    const media = networkCandidate(`${CDN}?token=abc`, { referer: PLAYER_SRC });
    assert.equal(select([media]).media?.id, media.id);
  });

  test('provenance compares initiator origins only, never media host or path', () => {
    const context = { playerKind: 'iframe' as const, activeVideoCurrentSrc: PLAYER_SRC, pageUrl: PAGE };
    assert.equal(resolveGeneralRequestProvenance({ frameUrl: 'https://player.embedhost.io/' }, context), 'OWNER_FRAME');
    assert.equal(resolveGeneralRequestProvenance({ frameUrl: 'https://news.example.org/story/42' }, context), 'TOP_DOCUMENT');
    assert.equal(resolveGeneralRequestProvenance({ frameUrl: 'https://ads.adnetwork.example/' }, context), 'OTHER_FRAME');
    assert.equal(resolveGeneralRequestProvenance({ frameUrl: null }, context), 'UNKNOWN');
  });

  test('media requested by another frame (ad/background iframe) is rejected', () => {
    iframeOwner();
    const ad = networkCandidate(`${CDN}?token=abc`, { referer: 'https://ads.adnetwork.example/' });
    const picked = select([ad]);
    assert.equal(picked.media, null);
    assert.equal(picked.group.rejected[0]?.reason, 'FOREIGN_FRAME_MEDIA');
  });

  test('media requested by the page itself is not the iframe player’s', () => {
    iframeOwner();
    const pageMedia = networkCandidate(`${CDN}?token=abc`, { referer: 'https://news.example.org/' });
    assert.equal(select([pageMedia]).group.rejected[0]?.reason, 'OUTSIDE_CURRENT_PLAYER');
  });

  test('a request without initiator evidence stays unproven, not owned', () => {
    iframeOwner();
    const unknown = networkCandidate(`${CDN}?token=abc`, { referer: null });
    assert.equal(select([unknown]).group.rejected[0]?.reason, 'UNPROVEN_FRAME_OWNERSHIP');
  });
});

describe('top-level players, preload and generations', () => {
  test('E: another resource requested while a visible player plays different media is an offscreen preload', () => {
    videoOwner({ src: 'https://media.example.org/v/current-clip?sig=1', paused: false, intersectionRatio: 1 });
    const preload = networkCandidate('https://media.example.org/v/next-clip?sig=2', { referer: 'https://news.example.org/' });
    const picked = select([preload]);
    assert.equal(picked.media, null);
    assert.equal(picked.group.rejected[0]?.reason, 'OFFSCREEN_PRELOAD');
  });

  test('F: when the preloaded video becomes the visible playing element it is owned (STRONG)', () => {
    const preload = networkCandidate('https://media.example.org/v/next-clip?sig=2', { referer: 'https://news.example.org/' });
    videoOwner({ src: 'https://media.example.org/v/current-clip?sig=1', paused: false, intersectionRatio: 1 });
    assert.equal(select([preload]).media, null);
    const generationAtPreload = preload.observedPageGeneration;
    videoOwner({ src: 'https://media.example.org/v/next-clip?sig=9', paused: false, intersectionRatio: 0.9, element: 'video:1' });
    // The visible element changed, so the page generation moved on; the fully buffered preload sends no new request.
    assert.notEqual(generalPageMediaContextStore.get(TAB)?.pageGeneration, generationAtPreload);
    const upgraded = select([preload]);
    assert.equal(upgraded.media?.id, preload.id);
    assert.equal(upgraded.group.confidence, 'STRONG');
  });

  test('E: the page’s only video, preloaded far offscreen and never played, cannot own current content', () => {
    const src = 'https://media.example.org/v/below-the-fold?sig=1';
    videoOwner({ src, paused: true, intersectionRatio: 0 });
    const preload = networkCandidate(src, { referer: 'https://news.example.org/' });
    const picked = select([preload]);
    assert.equal(picked.media, null);
    assert.equal(picked.group.rejected[0]?.reason, 'OFFSCREEN_PRELOAD');
  });

  test('E: an idle video whose visibility is not known yet is at most WEAK', () => {
    const src = 'https://media.example.org/v/unknown-visibility?sig=1';
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE, elementIdentity: 'video:0', currentSrc: src, src, isBlob: false, paused: true, ended: false,
        readyState: 1, videoWidth: 640, videoHeight: 360, muted: false, currentTimeBucket: 0, intersectionRatio: null,
        viewportCenterDistance: null, isDisplayed: true, isVisibleStyle: true, recentlyPlayed: false,
        explicitAdMarker: false, associatedContentId: null, observedAt: Date.now(),
      },
    });
    const candidate = networkCandidate(src, { referer: 'https://news.example.org/' });
    assert.equal(select([candidate]).group.confidence, 'WEAK');
  });

  test('a video the user was watching stays owned after scrolling it offscreen', () => {
    const src = 'https://media.example.org/v/watched?sig=1';
    videoOwner({ src, paused: false, intersectionRatio: 0.05 });
    const candidate = networkCandidate(src, { referer: 'https://news.example.org/' });
    const picked = select([candidate]);
    assert.equal(picked.media?.id, candidate.id);
    assert.notEqual(picked.group.confidence, 'REJECTED');
  });

  test('a visible paused video is owned (MEDIUM) before play', () => {
    const src = 'https://media.example.org/v/visible-paused?sig=1';
    videoOwner({ src, paused: true, intersectionRatio: 1 });
    const candidate = networkCandidate(src, { referer: 'https://news.example.org/' });
    assert.equal(select([candidate]).group.confidence, 'MEDIUM');
  });

  test('a low-resolution player partly in view (paused, unmuted, controls) is owned, not a tiny preview', () => {
    // Intrinsic 320×176 and 33% visible under the fold: decoded size and scroll position are not a preview role.
    const src = 'https://media.example.org/v/small-clip.mp4';
    videoOwner({ src, paused: true, intersectionRatio: 0.33, width: 320, height: 176 });
    const candidate = networkCandidate(src, { referer: 'https://news.example.org/' });
    const picked = select([candidate]);
    assert.equal(picked.media?.id, candidate.id);
    assert.equal(picked.group.confidence, 'MEDIUM');
  });

  test('a tiny muted playing loop stays WEAK (background media) until it is unmuted', () => {
    const src = 'https://media.example.org/v/a1b2c3.mp4';
    videoOwner({ src, paused: false, intersectionRatio: 1, width: 200, height: 112, muted: true });
    const candidate = networkCandidate(src, { referer: 'https://news.example.org/' });
    assert.equal(select([candidate]).group.confidence, 'WEAK');
    videoOwner({ src, paused: false, intersectionRatio: 1, width: 200, height: 112, muted: false });
    assert.equal(select([candidate]).group.confidence, 'STRONG');
  });

  test('G: a candidate observed in the previous SPA generation cannot be selected for the new content', () => {
    videoOwner({ src: 'https://media.example.org/v/clip-a?sig=1', paused: false, intersectionRatio: 1 });
    const late = networkCandidate('https://media.example.org/v/clip-a?sig=1', { referer: 'https://news.example.org/', generation: 1 });
    generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: 'https://news.example.org/story/43', navigationEpoch: 0 });
    const picked = selectCurrentGeneralMedia({
      candidates: [late],
      context: generalPageMediaContextStore.get(TAB),
      tabId: TAB,
      navigationEpoch: 0,
      pageGeneration: generalPageMediaContextStore.get(TAB)?.pageGeneration,
      pageUrl: 'https://news.example.org/story/43',
    });
    assert.equal(picked.media, null);
    assert.equal(picked.group.rejected[0]?.reason, 'STALE_PAGE_GENERATION');
  });

  test('T: blob (MSE) player + underlying resource fetched by the page is eligible', () => {
    videoOwner({ src: 'blob:https://news.example.org/5f1c', paused: false, intersectionRatio: 1 });
    const underlying = networkCandidate(`${CDN}?token=abc`, { referer: 'https://news.example.org/' });
    const picked = select([underlying]);
    assert.equal(picked.media?.id, underlying.id);
    assert.notEqual(picked.group.confidence, 'REJECTED');
  });

  test('T: blob player does not adopt media requested by a different frame', () => {
    videoOwner({ src: 'blob:https://news.example.org/5f1c', paused: false, intersectionRatio: 1 });
    const foreign = networkCandidate(`${CDN}?token=abc`, { referer: 'https://ads.adnetwork.example/' });
    assert.equal(select([foreign]).group.rejected[0]?.reason, 'FOREIGN_FRAME_MEDIA');
  });

  test('T: blob player + resource fetched by the page script (js_fetch, no Referer on record) is eligible', () => {
    videoOwner({ src: 'blob:https://news.example.org/5f1c', paused: false, intersectionRatio: 1 });
    const fetched = { ...networkCandidate(`${CDN}?token=abc`, { referer: null }), detectionSource: 'js_fetch' as const };
    const picked = select([fetched]);
    assert.equal(picked.media?.id, fetched.id);
    assert.notEqual(picked.group.confidence, 'REJECTED');
  });

  test('page-script observations are the top document, never the iframe player', () => {
    iframeOwner();
    const fetched = { ...networkCandidate(`${CDN}?token=abc`, { referer: null }), detectionSource: 'js_xhr' as const };
    assert.equal(select([fetched]).group.rejected[0]?.reason, 'OUTSIDE_CURRENT_PLAYER');
  });

  test('U: blob-only playback with no observable source selects nothing', () => {
    videoOwner({ src: 'blob:https://news.example.org/5f1c', paused: false, intersectionRatio: 1 });
    assert.equal(select([]).media, null);
  });
});

describe('resource identity (H/I/S)', () => {
  test('H: signed URL credential rotation collapses into one candidate', () => {
    const first = networkCandidate(`${CDN}?token=aaa&expires=4102444800`);
    const second = mediaDetectionPipeline.processNetworkUrl([first], `${CDN}?token=bbb&expires=4102444900`, PAGE, [], {
      detectionSource: 'native_network', hasRange: true, isForMainFrame: false,
    });
    assert.equal(second.media.length, 1);
    assert.equal(second.inserted, 0);
  });

  test('I: a meaningful quality selector stays a separate resource', () => {
    const low = networkCandidate(`${CDN}?q=360&token=aaa`);
    const high = mediaDetectionPipeline.processNetworkUrl([low], `${CDN}?q=720&token=aaa`, PAGE, [], {
      detectionSource: 'native_network', hasRange: true, isForMainFrame: false,
    });
    assert.equal(high.media.length, 2);
  });

  test('S: the same resource observed by DOM and native network is one candidate', () => {
    const url = 'https://media.example.org/clips/intro.mp4';
    const dom = mediaDetectionPipeline.processNetworkUrl([], url, PAGE, [], { detectionSource: 'dom_video' });
    const native = mediaDetectionPipeline.processNetworkUrl(dom.media, url, PAGE, [], {
      detectionSource: 'native_network', hasRange: true, isForMainFrame: false,
    });
    assert.equal(native.media.length, 1);
  });
});

describe('recycled players, thumbnails and blob hand-over (Phase 15A)', () => {
  function playerEvidence(input: {
    src: string | null;
    element?: string;
    playing?: boolean;
    muted?: boolean;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  }): void {
    const src = input.src;
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE, elementIdentity: input.element ?? 'video:0', currentSrc: src, src, isBlob: Boolean(src?.startsWith('blob:')),
        paused: !(input.playing ?? true), ended: false, readyState: 4, videoWidth: input.videoWidth ?? 720,
        videoHeight: input.videoHeight ?? 1280, muted: input.muted ?? false, currentTimeBucket: 0, intersectionRatio: 1,
        viewportCenterDistance: 0, displayWidth: input.displayWidth ?? 390, displayHeight: input.displayHeight ?? 620,
        isDisplayed: true, isVisibleStyle: true, recentlyPlayed: input.playing ?? true, explicitAdMarker: false,
        associatedContentId: null, observedAt: Date.now(),
      },
    });
  }

  /** A DOM candidate the page reported for a <video> element. */
  function ownedCandidate(url: string, element = 'video:0'): DetectedMedia {
    return { ...networkCandidate(url, { referer: 'https://news.example.org/' }), ownerElementIdentity: element, detectionSource: 'dom_video' };
  }

  test('the same recycled element playing the next item does not keep its previous source current', () => {
    const first = 'https://media.example.org/v/item-1.mp4';
    const second = 'https://media.example.org/v/item-2.mp4';
    playerEvidence({ src: first });
    const earlier = ownedCandidate(first);
    playerEvidence({ src: second });
    const next = ownedCandidate(second);
    const picked = select([earlier, next]);
    assert.equal(picked.media?.id, next.id);
    assert.equal(picked.group.confidence, 'STRONG');
    const rejected = picked.group.rejected.find((r) => r.candidateId === earlier.id);
    assert.ok(rejected, 'the previous item must be rejected, not merely ranked lower');
  });

  test('a player between items (no source) makes nothing current, least of all what it played before', () => {
    const first = 'https://media.example.org/v/item-1.mp4';
    playerEvidence({ src: first });
    const earlier = ownedCandidate(first);
    playerEvidence({ src: null, playing: false });
    const network = networkCandidate('https://media.example.org/v/unrelated.mp4', { referer: 'https://news.example.org/' });
    const picked = select([earlier, network]);
    assert.ok(picked.group.confidence === 'WEAK' || picked.group.confidence === 'REJECTED' || picked.media == null);
  });

  test('a full-resolution video drawn as a thumbnail is a tiny preview (never STRONG)', () => {
    const src = 'https://media.example.org/v/suggested.mp4';
    playerEvidence({ src, muted: true, videoWidth: 1280, videoHeight: 720, displayWidth: 120, displayHeight: 68 });
    const picked = select([ownedCandidate(src)]);
    assert.notEqual(picked.group.confidence, 'STRONG');
    assert.notEqual(picked.group.confidence, 'MEDIUM');
  });

  test('a recycled blob player keeps the source requested just before its new blob was attached', () => {
    playerEvidence({ src: 'blob:https://news.example.org/aaaa' });
    const nextSource = networkCandidate('https://media.example.org/v/item-2.mp4', { referer: 'https://news.example.org/' });
    playerEvidence({ src: 'blob:https://news.example.org/bbbb' });
    assert.notEqual(generalPageMediaContextStore.get(TAB)?.pageGeneration, nextSource.observedPageGeneration);
    const picked = select([nextSource]);
    assert.equal(picked.media?.id, nextSource.id);
    assert.ok(picked.group.confidence === 'MEDIUM' || picked.group.confidence === 'STRONG');
  });

  test('a source requested long before the hand-over, or two generations ago, is not carried', () => {
    playerEvidence({ src: 'blob:https://news.example.org/aaaa' });
    const old = { ...networkCandidate('https://media.example.org/v/item-1.mp4', { referer: 'https://news.example.org/' }), detectedAt: Date.now() - 60_000 };
    playerEvidence({ src: 'blob:https://news.example.org/bbbb' });
    assert.equal(select([old]).media, null);

    const twoAgo = networkCandidate('https://media.example.org/v/item-2.mp4', { referer: 'https://news.example.org/' });
    playerEvidence({ src: 'blob:https://news.example.org/cccc' });
    playerEvidence({ src: 'blob:https://news.example.org/dddd' });
    assert.equal(select([twoAgo]).media, null);
  });

  test('a source observed for the current blob outranks one carried over from the previous item', () => {
    playerEvidence({ src: 'blob:https://news.example.org/aaaa' });
    const carried = networkCandidate('https://media.example.org/v/item-2.mp4', { referer: 'https://news.example.org/' });
    playerEvidence({ src: 'blob:https://news.example.org/bbbb' });
    const current = networkCandidate('https://media.example.org/v/item-3.mp4', { referer: 'https://news.example.org/' });
    assert.equal(select([carried, current]).media?.id, current.id);
  });
});

describe('one shared feed player moving between items (Dailymotion-style autoplay feed)', () => {
  const MANIFEST = (id: string) => `https://cdn.feedhost.tv/cdn/manifest/video/${id}.m3u8?sec=s1g${id}&dmTs=91`;

  /** The page's one iframe player, laid over the feed item `item` (null: between items). */
  function sharedPlayerOver(item: string | null, displayed = true, iframeIdentity = 'iframe:0'): void {
    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE,
        iframeIdentity,
        iframeSrc: PLAYER_SRC,
        frameClass: 'cross-origin',
        isDisplayed: displayed,
        isVisibleStyle: displayed,
        intersectionRatio: displayed ? 1 : 0,
        width: displayed ? 390 : 0,
        height: displayed ? 219 : 0,
        allowFullscreen: true,
        allow: 'autoplay; fullscreen',
        looksPlayer: true,
        sameOriginVideoCount: 0,
        associatedContentId: item,
      },
    });
  }

  test('the item the player is over is the current video, and its manifest is offered', () => {
    sharedPlayerOver('xa1b2c3');
    assert.equal(generalPageMediaContextStore.get(TAB)?.currentMediaIdentity, 'video:xa1b2c3');
    const first = networkCandidate(MANIFEST('xa1b2c3'));
    const picked = select([first]);
    assert.equal(picked.media?.id, first.id);
    assert.equal(picked.group.confidence, 'STRONG');
  });

  test('moving over the next item starts a new video: the previous item’s manifest is rejected, never offered', () => {
    sharedPlayerOver('xa1b2c3');
    const first = networkCandidate(MANIFEST('xa1b2c3'));
    const generation = generalPageMediaContextStore.get(TAB)?.pageGeneration ?? 0;
    sharedPlayerOver('xd4e5f6');
    const ctx = generalPageMediaContextStore.get(TAB);
    assert.equal(ctx?.currentMediaIdentity, 'video:xd4e5f6');
    assert.equal(ctx?.pageGeneration, generation + 1);
    const picked = select([first]);
    assert.equal(picked.media, null);
    const rejected = picked.group.rejected.find((r) => r.candidateId === first.id);
    assert.ok(rejected, 'the previous item must be explicitly rejected');
  });

  test('the next item’s manifest requested before the page reported the move (or long before) is still its source', () => {
    sharedPlayerOver('xa1b2c3');
    const first = networkCandidate(MANIFEST('xa1b2c3'));
    const early = { ...networkCandidate(MANIFEST('xd4e5f6')), detectedAt: Date.now() - 50_000 };
    sharedPlayerOver('xd4e5f6');
    const picked = select([first, early]);
    assert.equal(picked.media?.id, early.id);
    assert.equal(picked.group.confidence, 'STRONG');
  });

  test('a stream naming no item (an ad break) never replaces the item’s own manifest', () => {
    sharedPlayerOver('xd4e5f6');
    const ad = networkCandidate('https://ads.adhost.example/creative/28jf0a/master.m3u8');
    const own = networkCandidate(MANIFEST('xd4e5f6'));
    const picked = select([ad, own]);
    assert.equal(picked.media?.id, own.id);
    assert.ok(!picked.group.activeCandidateIds.includes(ad.id), 'the unnamed stream must not be offered');
  });

  test('a report from between items keeps the item the player showed; scrolling back resolves the earlier item again', () => {
    sharedPlayerOver('xa1b2c3');
    const first = networkCandidate(MANIFEST('xa1b2c3'));
    sharedPlayerOver(null);
    assert.equal(generalPageMediaContextStore.get(TAB)?.currentMediaIdentity, 'video:xa1b2c3');
    sharedPlayerOver('xd4e5f6');
    const second = networkCandidate(MANIFEST('xd4e5f6'));
    assert.equal(select([first, second]).media?.id, second.id);
    sharedPlayerOver('xa1b2c3');
    assert.equal(generalPageMediaContextStore.get(TAB)?.currentMediaIdentity, 'video:xa1b2c3');
    const back = select([first, second]);
    assert.equal(back.media?.id, first.id);
    assert.equal(back.group.confidence, 'STRONG');
  });

  test('the player hiding itself (to move to the next item) marks the current video as not on screen', () => {
    sharedPlayerOver('xa1b2c3');
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
    sharedPlayerOver(null, false);
    const hidden = generalPageMediaContextStore.get(TAB);
    assert.equal(hidden?.activeOwnerHidden, true);
    assert.equal(hidden?.currentMediaIdentity, 'video:xa1b2c3', 'ownership is kept; only its presentation is withheld');
    sharedPlayerOver('xd4e5f6');
    const shown = generalPageMediaContextStore.get(TAB);
    assert.equal(shown?.activeOwnerHidden, false);
    assert.equal(shown?.currentMediaIdentity, 'video:xd4e5f6');
  });

  test('the player scrolled wholly out of view (before the page hides it) is off screen too', () => {
    sharedPlayerOver('xa1b2c3');
    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE, iframeIdentity: 'iframe:0', iframeSrc: PLAYER_SRC, frameClass: 'cross-origin', isDisplayed: true,
        isVisibleStyle: true, intersectionRatio: 0, width: 390, height: 219, allowFullscreen: true,
        allow: 'autoplay; fullscreen', looksPlayer: true, sameOriginVideoCount: 0, associatedContentId: null,
      },
    });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, true);
  });

  test('the player mostly scrolled away (below the share that makes an iframe the current player) is off screen', () => {
    sharedPlayerOver('xa1b2c3');
    const partly = (ratio: number) =>
      generalPageMediaContextStore.applyActiveIframePlayerEvidence({
        tabId: TAB,
        navigationEpoch: 0,
        evidence: {
          pageUrl: PAGE, iframeIdentity: 'iframe:0', iframeSrc: PLAYER_SRC, frameClass: 'cross-origin', isDisplayed: true,
          isVisibleStyle: true, intersectionRatio: ratio, width: 390, height: 219, allowFullscreen: true,
          allow: 'autoplay; fullscreen', looksPlayer: true, sameOriginVideoCount: 0, associatedContentId: 'xa1b2c3',
        },
      });
    partly(0.5);
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
    partly(0.24);
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, true);
    partly(0.9);
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
  });

  test('the page re-syncing its URL while the player is hidden keeps it hidden', () => {
    sharedPlayerOver('xa1b2c3');
    sharedPlayerOver(null, false);
    generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: PAGE, navigationEpoch: 0 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, true);
  });

  test('another hidden iframe (an ad slot, a parked player) says nothing about the current video', () => {
    sharedPlayerOver('xa1b2c3');
    sharedPlayerOver(null, false, 'iframe:7');
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
    assert.equal(generalPageMediaContextStore.get(TAB)?.currentMediaIdentity, 'video:xa1b2c3');
  });
});

describe('a video element out of view', () => {
  test('the page’s video below the fold, never on screen yet, keeps its offer', () => {
    const src = 'https://media.example.org/v/demo.mp4';
    generalPageMediaContextStore.applyActiveVideoEvidence({
      tabId: TAB,
      navigationEpoch: 0,
      evidence: {
        pageUrl: PAGE, elementIdentity: 'video:0', currentSrc: src, src, isBlob: false, paused: true, ended: false,
        readyState: 1, videoWidth: 640, videoHeight: 360, muted: false, currentTimeBucket: 0, intersectionRatio: null,
        viewportCenterDistance: null, isDisplayed: true, isVisibleStyle: true, recentlyPlayed: false,
        explicitAdMarker: false, associatedContentId: null, observedAt: Date.now(),
      },
    });
    videoOwner({ src, paused: true, intersectionRatio: 0 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
    videoOwner({ src, paused: true, intersectionRatio: 0.8 });
    videoOwner({ src, paused: true, intersectionRatio: 0 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, true, 'scrolled away after being seen');
  });

  test('a playing video scrolled out of view is still on screen for its offer; a paused one is not', () => {
    const src = 'https://media.example.org/v/talk.mp4';
    videoOwner({ src, paused: false, intersectionRatio: 1 });
    videoOwner({ src, paused: false, intersectionRatio: 0 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
    videoOwner({ src, paused: true, intersectionRatio: 0 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, true);
    videoOwner({ src, paused: true, intersectionRatio: 0.6 });
    assert.equal(generalPageMediaContextStore.get(TAB)?.activeOwnerHidden, false);
  });
});

describe('publishing a verified file', () => {
  test('a file the page now shows to be another item’s preload is not published; the playing one is', () => {
    const current = 'https://media.example.org/v/current-clip?sig=1';
    videoOwner({ src: current, paused: false, intersectionRatio: 1 });
    const own = { ...networkCandidate(current, { referer: 'https://news.example.org/' }), ownerElementIdentity: 'video:0', detectionSource: 'dom_video' as const };
    const preload = networkCandidate('https://media.example.org/v/next-clip?sig=2', { referer: 'https://news.example.org/' });
    const candidates = [own, preload];
    const ask = (sourceUrl: string) =>
      isOfferedSourceRejectedNow({ sourceUrl, candidates, tabId: TAB, navigationEpoch: 0, pageUrl: PAGE });
    assert.equal(ask('https://media.example.org/v/next-clip?sig=7'), true, 'same file, rotated signature');
    assert.equal(ask(current), false);
    assert.equal(ask('https://media.example.org/v/rendition-720.m3u8'), false, 'no candidate names it');
  });
});
