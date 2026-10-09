import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { MediaAnalysisResult } from '@/api/types';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import type { MediaRequestContext } from '@/downloads/types/request-context';

import { contentTokensOf } from './content-tokens';
import { decideDirectPublish, directOfferIdentity, matchesDirectPage, type DirectPublishInput } from './direct-offer-policy';
import { directCandidateMedia } from './direct-verifier';

const PASTED = 'https://m.site.example/watch/?v=2289516264908285';
const PAGES = [PASTED];
const TOKENS = contentTokensOf(PAGES);

function input(extra: Partial<DirectPublishInput> = {}): DirectPublishInput {
  return {
    sessionTabId: 'tab-1',
    activeTabId: 'tab-1',
    tabExists: true,
    tabUrl: PASTED,
    lastNavigation: PASTED,
    pageUrls: PAGES,
    contentTokens: TOKENS,
    navigationSeen: true,
    offer: { status: 'idle', contentIdentity: null, selectionLocked: false },
    offerIdentity: 'video:2289516264908285',
    identityConsumed: false,
    ...extra,
  };
}

describe('when a direct result becomes the tab\'s offer', () => {
  test('published once the tab shows the page and detection has started that navigation', () => {
    assert.deepEqual(decideDirectPublish(input()), { action: 'publish' });
  });

  test('waits while the tab has not navigated yet, and while detection is still on the previous page', () => {
    assert.deepEqual(decideDirectPublish(input({ tabUrl: 'about:blank', navigationSeen: false })), { action: 'wait', reason: 'NAVIGATION_PENDING' });
    assert.deepEqual(decideDirectPublish(input({ lastNavigation: 'https://news.example/earlier' })), {
      action: 'wait',
      reason: 'DETECTION_NAVIGATION_PENDING',
    });
  });

  test('a redirect or tracking rewrite of the same content is the same page; another video is not', () => {
    assert.equal(matchesDirectPage('https://m.site.example/watch/?v=2289516264908285&_rdr', PAGES, TOKENS), true);
    assert.equal(matchesDirectPage('https://www.site.example/Owner/videos/2289516264908285/', PAGES, TOKENS), true);
    assert.equal(matchesDirectPage('https://m.site.example/watch/?v=1376350954687257', PAGES, TOKENS), false);
    assert.equal(matchesDirectPage('https://elsewhere.example/2289516264908285', PAGES, TOKENS), false);
  });

  test('stale once the page\'s player shows another video under the same URL (the next reel); kept while it shows this one', () => {
    assert.deepEqual(decideDirectPublish(input({ liveMediaIdentity: 'v3:cdn.example/o1/v/next-reel.mp4' })), {
      action: 'stale',
      reason: 'OTHER_MEDIA_PLAYING',
    });
    assert.deepEqual(decideDirectPublish(input({ liveMediaIdentity: 'video:2289516264908285' })), { action: 'publish' });
    // No player evidence yet: nothing contradicts the pasted link.
    assert.deepEqual(decideDirectPublish(input({ liveMediaIdentity: null })), { action: 'publish' });
  });

  test('stale once the tab moved on to another page (Video 1 → Video 2), or the tab closed', () => {
    assert.deepEqual(decideDirectPublish(input({ tabUrl: 'https://m.site.example/watch/?v=1376350954687257' })), {
      action: 'stale',
      reason: 'NAVIGATED_AWAY',
    });
    assert.deepEqual(decideDirectPublish(input({ tabExists: false })), { action: 'stale', reason: 'CLOSED_TAB' });
  });

  test('waits while another tab is in front', () => {
    assert.deepEqual(decideDirectPublish(input({ activeTabId: 'tab-2' })), { action: 'wait', reason: 'TAB_NOT_ACTIVE' });
  });

  test('never a second CTA: an offer already standing (the same video, or what plays) is kept', () => {
    assert.deepEqual(
      decideDirectPublish(input({ offer: { status: 'verified', contentIdentity: 'video:2289516264908285', selectionLocked: false } })),
      { action: 'skip', reason: 'ALREADY_OFFERED' },
    );
    assert.deepEqual(decideDirectPublish(input({ offer: { status: 'verified', contentIdentity: 'video:other', selectionLocked: false } })), {
      action: 'skip',
      reason: 'WEBVIEW_OFFER_PRESENT',
    });
    assert.deepEqual(decideDirectPublish(input({ offer: { status: 'idle', contentIdentity: null, selectionLocked: true } })).action, 'skip');
    assert.deepEqual(decideDirectPublish(input({ identityConsumed: true })), { action: 'skip', reason: 'ALREADY_CONSUMED' });
  });

  test('the offer carries the identity the WebView pipeline gives the same page', () => {
    assert.equal(directOfferIdentity('https://www.instagram.com/reel/DdiUOZezpFs/'), 'instagram:instagram_reel:DdiUOZezpFs');
    assert.equal(directOfferIdentity('https://www.tiktok.com/@scout2015/video/6718335390845095173')?.endsWith('6718335390845095173'), true);
    assert.equal(directOfferIdentity(PASTED), 'video:2289516264908285');
    assert.equal(directOfferIdentity('https://www.dailymotion.com/video/xb346be'), 'video:xb346be');
    assert.equal(directOfferIdentity('https://www.w3schools.com/html/html5_video.asp'), null);
  });
});

describe('duplicate protection through the CTA service', () => {
  beforeEach(() => {
    browserMediaActionService.__resetAllForTests();
    browserMediaActionService.setActiveTab('tab-1');
  });

  const media = directCandidateMedia(
    {
      url: 'https://video.example/o1/v/main.mp4?oh=1',
      kind: 'progressive',
      audioUrl: null,
      evidence: 'content',
      origin: 'element_attribute',
      mimeType: null,
      width: null,
      height: null,
      bitrate: null,
      qualityLabel: null,
      durationMs: null,
    },
    PASTED,
    null,
  )!;
  const analysis = {
    title: 'Clip',
    sourceUrl: media.url,
    finalUrl: media.url,
    thumbnailUrl: null,
    mediaType: 'video',
    mimeType: 'video/mp4',
    container: 'mp4',
    duration: null,
    width: null,
    height: null,
    resolution: null,
    bitrate: null,
    fps: null,
    fileSize: null,
    platform: 'OTHER',
    downloadable: true,
    unsupportedReason: null,
    variants: [
      {
        id: 'v1',
        sourceUrl: media.url,
        streamType: 'PROGRESSIVE',
        label: 'Original',
        resolution: null,
        width: null,
        height: null,
        bitrate: null,
        averageBitrate: null,
        videoBitrate: null,
        audioBitrate: null,
        codecs: null,
        videoCodec: null,
        audioCodec: null,
        container: 'mp4',
        mimeType: 'video/mp4',
        estimatedFileSize: null,
        frameRate: null,
        downloadable: true,
        unsupportedReason: null,
      },
    ],
  } as unknown as MediaAnalysisResult;
  const publish = () =>
    browserMediaActionService.handoffVerified({
      pageUrl: PASTED,
      media,
      analysis,
      requestContext: { pageUrl: PASTED, headers: {}, capturedAt: 1, cookiesRequired: false, hasCookies: false } as unknown as MediaRequestContext,
      mediaUrl: media.url,
      autoShow: true,
      contentIdentity: 'video:2289516264908285',
      variantIdentity: 'v1',
    });

  test('the published offer is one AVAILABLE CTA; once downloaded, the same video is never offered again', () => {
    publish();
    assert.equal(browserMediaActionService.getState().status, 'verified');
    assert.equal(browserMediaActionService.getState().contentIdentity, 'video:2289516264908285');

    const claim = browserMediaActionService.claimForHandoff();
    assert.equal(claim.outcome, 'CLAIMED');
    if (claim.outcome !== 'CLAIMED') return;
    browserMediaActionService.commitConsumed(claim.tabId, claim.fingerprint, claim.handoffGeneration, 'dl-1');
    assert.equal(browserMediaActionService.isContentIdentityConsumed('video:2289516264908285'), true);

    // A later direct result for the same video (a re-paste, a republish) is refused by the policy…
    assert.deepEqual(
      decideDirectPublish(input({ identityConsumed: browserMediaActionService.isContentIdentityConsumed('video:2289516264908285') })),
      { action: 'skip', reason: 'ALREADY_CONSUMED' },
    );
    // …and even if handed over, the CTA service keeps it consumed.
    publish();
    assert.equal(browserMediaActionService.getState().status, 'consumed');
  });

  test('a new document resets the offer (stale pasted URL): nothing of Video 1 is shown on Video 2', () => {
    publish();
    browserMediaActionService.resetForNavigation('https://m.site.example/watch/?v=1376350954687257');
    assert.equal(browserMediaActionService.getState().status, 'idle');
    assert.equal(browserMediaActionService.getState().mediaFingerprint, null);
  });
});
