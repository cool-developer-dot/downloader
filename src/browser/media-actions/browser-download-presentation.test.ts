import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { MediaAnalysisResult } from '@/api/types';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import type { DetectedMedia } from '@/media-detection/types';

import {
  buildBrowserDownloadPresentation,
  resolveConsumedDownloadNotice,
  resolveOfferDuplicateNotice,
  type BrowserDownloadPresentationInput,
} from './browser-download-presentation';
import { initialBrowserMediaActionState, type BrowserMediaActionState } from './browser-media-action.types';

const TAB = 'tab-1';
const PAGE = 'https://www.feedhost.tv/';
const MANIFEST = 'https://cdn.feedhost.tv/cdn/manifest/video/xa1b2c3.m3u8?sec=abc';

function playerHidden(): void {
  generalPageMediaContextStore.applyActiveIframePlayerEvidence({
    tabId: TAB,
    navigationEpoch: 0,
    evidence: {
      pageUrl: PAGE, iframeIdentity: 'iframe:0', iframeSrc: 'https://player.feedhost.tv/player/p1.html', frameClass: 'cross-origin',
      isDisplayed: false, isVisibleStyle: false, intersectionRatio: 0, width: 0, height: 0, allowFullscreen: true,
      allow: 'autoplay; fullscreen', looksPlayer: true, sameOriginVideoCount: 0, associatedContentId: null,
    },
  });
}

function playerOver(item: string): string {
  generalPageMediaContextStore.applyActiveIframePlayerEvidence({
    tabId: TAB,
    navigationEpoch: 0,
    evidence: {
      pageUrl: PAGE, iframeIdentity: 'iframe:0', iframeSrc: 'https://player.feedhost.tv/player/p1.html', frameClass: 'cross-origin',
      isDisplayed: true, isVisibleStyle: true, intersectionRatio: 1, width: 390, height: 219, allowFullscreen: true,
      allow: 'autoplay; fullscreen', looksPlayer: true, sameOriginVideoCount: 0, associatedContentId: item,
    },
  });
  const identity = generalPageMediaContextStore.get(TAB)?.currentMediaIdentity ?? null;
  assert.equal(identity, `video:${item}`);
  return identity!;
}

function offerFor(identity: string, overrides: Partial<BrowserMediaActionState> = {}): BrowserMediaActionState {
  return {
    ...initialBrowserMediaActionState,
    status: 'verified',
    pageUrl: PAGE,
    media: { id: 'm1', url: MANIFEST, category: 'stream', mimeType: 'application/vnd.apple.mpegurl' } as DetectedMedia,
    analysis: { downloadable: true, finalUrl: MANIFEST, mimeType: 'application/vnd.apple.mpegurl' } as MediaAnalysisResult,
    mediaUrl: MANIFEST,
    mediaFingerprint: 'fp-a',
    contentIdentity: identity,
    ...overrides,
  };
}

function present(actionState: BrowserMediaActionState, extra: Partial<BrowserDownloadPresentationInput> = {}) {
  const live = generalPageMediaContextStore.get(TAB)?.currentMediaIdentity ?? null;
  return buildBrowserDownloadPresentation({
    actionState,
    activeTabId: TAB,
    isHome: false,
    hasBrowserError: false,
    overlayBlocking: false,
    currentPageUrl: PAGE,
    hasDownloadableOptions: true,
    liveContentIdentity: live,
    liveOwnershipConfidence: live ? 'MEDIUM' : null,
    ...extra,
  });
}

beforeEach(() => {
  generalPageMediaContextStore.clearAll();
  generalPageMediaContextStore.setActiveTab(TAB);
  generalPageMediaContextStore.syncFromPageUrl({ tabId: TAB, pageUrl: PAGE, navigationEpoch: 0 });
});

describe('the media-action area never points at a previous video', () => {
  test('the current video’s verified offer is the Download button', () => {
    const a = playerOver('xa1b2c3');
    const p = present(offerFor(a));
    assert.equal(p.showCard, true);
    assert.equal(p.statusNotice, null);
  });

  test('scrolling to the next video hides the offer at once and shows nothing while it is resolved', () => {
    const a = playerOver('xa1b2c3');
    playerOver('xd4e5f6');
    for (const status of ['verified', 'detecting', 'idle'] as const) {
      const p = present(offerFor(a, { status }));
      assert.equal(p.showCard, false, status);
      assert.equal(p.statusNotice, null, status);
    }
  });

  test('an offer the user already has reads Already downloaded', () => {
    const a = playerOver('xa1b2c3');
    const p = present(offerFor(a), { offerDuplicate: true });
    assert.equal(p.showCard, true);
    assert.equal(p.statusNotice, 'ALREADY_DOWNLOADED');
  });

  test('a proven verdict about the video on screen is shown for it', () => {
    playerOver('xa1b2c3');
    const p = present({ ...initialBrowserMediaActionState, pageUrl: PAGE }, { liveVerdict: 'PROTECTED' });
    assert.equal(p.showCard, false);
    assert.equal(p.statusNotice, 'PROTECTED');
  });

  test('a failure about the previous video does not label the next one unsupported', () => {
    const a = playerOver('xa1b2c3');
    playerOver('xd4e5f6');
    const failed = offerFor(a, { status: 'failed', errorMessage: 'boom', analysis: null, mediaFingerprint: null });
    const p = present(failed);
    assert.equal(p.showCard, false);
    assert.notEqual(p.statusNotice, 'UNSUPPORTED');
  });

  test('while the offered video’s player is hidden (moving to the next item) there is no Download and no status', () => {
    const a = playerOver('xa1b2c3');
    playerHidden();
    const hidden = present(offerFor(a), { liveOwnerHidden: true });
    assert.equal(hidden.showCard, false);
    assert.equal(hidden.statusNotice, null);
    // The same player back over the same item: its offer is shown again at once.
    playerOver('xa1b2c3');
    assert.equal(present(offerFor(a)).showCard, true);
  });

  test('a video on a YouTube page is never "being analyzed": it is not downloadable', () => {
    const yt = 'https://m.youtube.com/shorts/mx1MHYuogGc';
    const p = present(initialBrowserMediaActionState, {
      currentPageUrl: yt,
      liveContentIdentity: 'video:mx1MHYuogGc',
      liveOwnershipConfidence: 'MEDIUM',
    });
    assert.equal(p.showCard, false);
    assert.equal(p.statusNotice, 'UNSUPPORTED');
  });

  test('the home page shows no status', () => {
    playerOver('xa1b2c3');
    assert.equal(present(initialBrowserMediaActionState, { isHome: true }).statusNotice, null);
  });
});

describe('download states: Downloading… → Downloaded, Already downloaded only for a video that existed before', () => {
  const fresh = { downloadId: 'dl-1', preExisting: false, revisited: false };

  test('a first download reads Downloading… while it runs and Downloaded when it completes', () => {
    for (const status of ['QUEUED', 'DOWNLOADING', 'PAUSED'] as const) {
      assert.equal(resolveConsumedDownloadNotice(fresh, status), 'DOWNLOADING', status);
    }
    assert.equal(resolveConsumedDownloadNotice(fresh, 'COMPLETED'), 'DOWNLOADED');
    assert.notEqual(resolveConsumedDownloadNotice(fresh, 'DOWNLOADING'), 'ALREADY_DOWNLOADED');
  });

  test('Already downloaded only when it existed before the tap, or on coming back to it', () => {
    assert.equal(
      resolveConsumedDownloadNotice({ downloadId: 'lib-1', preExisting: true, revisited: false }, null),
      'ALREADY_DOWNLOADED',
    );
    assert.equal(resolveConsumedDownloadNotice({ ...fresh, revisited: true }, 'COMPLETED'), 'ALREADY_DOWNLOADED');
    assert.equal(resolveConsumedDownloadNotice({ ...fresh, revisited: true }, 'DOWNLOADING'), 'DOWNLOADING');
  });

  test('a failed, cancelled or removed download says nothing rather than something false', () => {
    assert.equal(resolveConsumedDownloadNotice(fresh, 'FAILED'), null);
    assert.equal(resolveConsumedDownloadNotice(fresh, 'CANCELLED'), null);
    assert.equal(resolveConsumedDownloadNotice(fresh, null), null);
    assert.equal(resolveConsumedDownloadNotice(null, 'COMPLETED'), null);
  });

  test('an offer whose video is already downloading reads Downloading…, never Already downloaded', () => {
    assert.equal(resolveOfferDuplicateNotice({ kind: 'DOWNLOADING', downloadId: 'dl-2' }, 'DOWNLOADING'), 'DOWNLOADING');
    assert.equal(resolveOfferDuplicateNotice({ kind: 'DOWNLOADING', downloadId: 'dl-2' }, null), 'DOWNLOADING');
    assert.equal(resolveOfferDuplicateNotice({ kind: 'DOWNLOADING', downloadId: 'dl-2' }, 'COMPLETED'), 'DOWNLOADED');
    assert.equal(resolveOfferDuplicateNotice({ kind: 'DOWNLOADED', downloadId: null }, null), 'ALREADY_DOWNLOADED');
  });

  test('the consumed current video shows its download state instead of Already downloaded', () => {
    const a = playerOver('xa1b2c3');
    const consumed = offerFor(a, { status: 'consumed' });
    assert.equal(present(consumed, { liveIdentityConsumed: true, consumedNotice: 'DOWNLOADING' }).statusNotice, 'DOWNLOADING');
    assert.equal(present(consumed, { liveIdentityConsumed: true, consumedNotice: 'DOWNLOADED' }).statusNotice, 'DOWNLOADED');
    assert.equal(present(consumed, { liveIdentityConsumed: true, consumedNotice: null }).statusNotice, null);
  });

  test('a standing offer already downloading is labelled Downloading…', () => {
    const a = playerOver('xa1b2c3');
    const p = present(offerFor(a), { offerDuplicate: false, offerDuplicateNotice: 'DOWNLOADING' });
    assert.equal(p.showCard, true);
    assert.equal(p.statusNotice, 'DOWNLOADING');
  });
});

describe('Detecting video… only for the current video while it is actively resolved', () => {
  test('a new current video with nothing known yet reads Detecting', () => {
    const a = playerOver('xa1b2c3');
    playerOver('xd4e5f6');
    const p = present(offerFor(a, { status: 'detecting' }), { liveDetecting: true });
    assert.equal(p.showCard, false);
    assert.equal(p.statusNotice, 'DETECTING');
  });

  test('the previous video’s offer never shows while the next one is detected', () => {
    const a = playerOver('xa1b2c3');
    playerOver('xd4e5f6');
    const p = present(offerFor(a), { liveDetecting: true });
    assert.equal(p.showCard, false);
    assert.equal(p.statusNotice, 'DETECTING');
  });

  test('an offer for the current video replaces Detecting with Video available', () => {
    const b = playerOver('xd4e5f6');
    const p = present(offerFor(b), { liveDetecting: true });
    assert.equal(p.showCard, true);
    assert.equal(p.statusNotice, null);
  });

  test('a final verdict wins over detecting; without active detection nothing is shown', () => {
    playerOver('xa1b2c3');
    const idle = { ...initialBrowserMediaActionState, pageUrl: PAGE };
    assert.equal(present(idle, { liveDetecting: true, liveVerdict: 'PROTECTED' }).statusNotice, 'PROTECTED');
    assert.equal(present(idle, { liveDetecting: false }).statusNotice, null);
  });

  test('no Detecting while the player is hidden, on Home, or without a current video', () => {
    playerOver('xa1b2c3');
    const idle = { ...initialBrowserMediaActionState, pageUrl: PAGE };
    assert.equal(present(idle, { liveDetecting: true, liveOwnerHidden: true }).statusNotice, null);
    assert.equal(present(idle, { liveDetecting: true, isHome: true }).statusNotice, null);
    assert.equal(
      present(idle, { liveDetecting: true, liveContentIdentity: null, liveOwnershipConfidence: null }).statusNotice,
      null,
    );
  });
});
