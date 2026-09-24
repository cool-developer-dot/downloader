import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import { browserMediaActionService } from './browser-media-action.service';
import type { BrowserMediaVerifiedHandoff } from './browser-media-action.types';

const PAGE = 'https://news.example.org/story/42';

beforeEach(() => {
  browserMediaActionService.__resetAllForTests();
});

describe('in-flight first verification vs offer invalidation', () => {
  test('candidate enrichment / ownership upgrade for the same content does not abort verification', () => {
    const identity = 'general:element:iframe:0|player.embedhost.io/embed/zz91';
    browserMediaActionService.setDetecting(PAGE);
    const signal = browserMediaActionService.beginVerification(identity);

    assert.equal(browserMediaActionService.invalidateStaleSocialOffer(identity, 'MEDIUM'), false);
    assert.equal(browserMediaActionService.invalidateStaleSocialOffer(identity, 'STRONG'), false);
    assert.equal(signal.aborted, false);
    assert.equal(browserMediaActionService.getState().status, 'detecting');
  });

  test('R: a verification still running for different (previous) content is cancelled', () => {
    browserMediaActionService.setDetecting(PAGE);
    const signal = browserMediaActionService.beginVerification('general:reel-1');

    assert.equal(browserMediaActionService.invalidateStaleSocialOffer('general:reel-2', 'STRONG'), true);
    assert.equal(signal.aborted, true);
    assert.equal(browserMediaActionService.getState().status, 'idle');
  });

  test('weak or missing next identity never cancels anything', () => {
    browserMediaActionService.setDetecting(PAGE);
    const signal = browserMediaActionService.beginVerification('general:reel-1');
    assert.equal(browserMediaActionService.invalidateStaleSocialOffer('general:reel-2', 'WEAK'), false);
    assert.equal(browserMediaActionService.invalidateStaleSocialOffer(null, 'STRONG'), false);
    assert.equal(signal.aborted, false);
  });
});

describe('protected playback withdraws a standing offer (Phase 11B)', () => {
  test('a verification in flight for a protected player is cancelled and the CTA goes idle', () => {
    browserMediaActionService.setDetecting(PAGE);
    const signal = browserMediaActionService.beginVerification('general:blob-player-1');

    assert.equal(browserMediaActionService.invalidateProtectedOffer(), true);
    assert.equal(signal.aborted, true);
    assert.equal(browserMediaActionService.getState().status, 'idle');
    assert.equal(browserMediaActionService.getVerifiedCandidateId(), null);
    assert.equal(browserMediaActionService.getState().contentIdentity, null);
  });

  test('nothing to withdraw is a no-op', () => {
    assert.equal(browserMediaActionService.invalidateProtectedOffer(), false);
  });

  test('a handoff already in flight is left to its own staleness checks', () => {
    browserMediaActionService.setDetecting(PAGE);
    browserMediaActionService.beginVerification('general:blob-player-1');
    browserMediaActionService.setStatus('preparing');

    assert.equal(browserMediaActionService.invalidateProtectedOffer(), false);
    assert.equal(browserMediaActionService.getState().status, 'preparing');
  });
});

describe('a download that needs a fresh link gives its video back to the page', () => {
  const FIRST_LINK = 'https://cdn.example.org/v/clip.mp4?exp=1&sig=aa';
  const FRESH_LINK = 'https://cdn.example.org/v/clip.mp4?exp=2&sig=bb';

  function offer(mediaUrl: string, contentIdentity = 'general:clip'): void {
    browserMediaActionService.setVerified({
      pageUrl: PAGE,
      media: { id: `media:${mediaUrl}` } as unknown as BrowserMediaVerifiedHandoff['media'],
      analysis: { platform: 'generic' } as unknown as BrowserMediaVerifiedHandoff['analysis'],
      requestContext: { authMode: 'PUBLIC' } as unknown as BrowserMediaVerifiedHandoff['requestContext'],
      mediaUrl,
      contentIdentity,
    });
  }

  function download(downloadId: string): void {
    const claim = browserMediaActionService.claimForHandoff();
    assert.equal(claim.outcome, 'CLAIMED');
    if (claim.outcome === 'CLAIMED') {
      assert.equal(
        browserMediaActionService.commitConsumed(claim.tabId, claim.fingerprint, claim.handoffGeneration, downloadId),
        true,
      );
    }
  }

  test('after the failure the page offers the same video again, with the link it has now', () => {
    offer(FIRST_LINK);
    download('dl-1');
    offer(FRESH_LINK);
    assert.equal(browserMediaActionService.getState().status, 'consumed');

    assert.equal(browserMediaActionService.releaseConsumedDownload('dl-1'), true);
    assert.equal(browserMediaActionService.getState().status, 'idle');

    offer(FRESH_LINK);
    assert.equal(browserMediaActionService.getState().status, 'verified');
    assert.equal(browserMediaActionService.getState().mediaUrl, FRESH_LINK);
    assert.equal(browserMediaActionService.claimForHandoff().outcome, 'CLAIMED');
  });

  test('an unknown download, or one already given back, changes nothing', () => {
    offer(FIRST_LINK);
    download('dl-1');

    assert.equal(browserMediaActionService.releaseConsumedDownload('dl-other'), false);
    assert.equal(browserMediaActionService.getState().status, 'consumed');
    assert.equal(browserMediaActionService.releaseConsumedDownload('dl-1'), true);
    assert.equal(browserMediaActionService.releaseConsumedDownload('dl-1'), false);
  });

  test('another video of the page that downloaded fine stays downloaded', () => {
    offer('https://cdn.example.org/v/other.mp4', 'general:other');
    download('dl-other');
    offer(FIRST_LINK);
    download('dl-1');

    assert.equal(browserMediaActionService.releaseConsumedDownload('dl-1'), true);
    offer('https://cdn.example.org/v/other.mp4', 'general:other');
    assert.equal(browserMediaActionService.getState().status, 'consumed');
  });
});

describe('a tab switch is not a navigation inside the tab', () => {
  const PAGE_A = 'https://site-a.example.org/watch/1';
  const PAGE_B = 'https://site-b.example.org/clip/2';

  function offerOn(pageUrl: string, mediaUrl: string): void {
    browserMediaActionService.setVerified({
      pageUrl,
      media: { id: `media:${mediaUrl}` } as unknown as BrowserMediaVerifiedHandoff['media'],
      analysis: { platform: 'generic' } as unknown as BrowserMediaVerifiedHandoff['analysis'],
      requestContext: { authMode: 'PUBLIC' } as unknown as BrowserMediaVerifiedHandoff['requestContext'],
      mediaUrl,
      contentIdentity: `general:${mediaUrl}`,
    });
  }

  function downloadOffer(downloadId: string): void {
    const claim = browserMediaActionService.claimForHandoff();
    assert.equal(claim.outcome, 'CLAIMED');
    if (claim.outcome === 'CLAIMED') {
      browserMediaActionService.commitConsumed(claim.tabId, claim.fingerprint, claim.handoffGeneration, downloadId);
    }
  }

  test('coming back to a tab keeps what it already downloaded, so the same video is not offered twice', () => {
    browserMediaActionService.setActiveTab('tab-b');
    offerOn(PAGE_B, 'https://cdn.example.org/b.mp4');
    downloadOffer('dl-b');

    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.resetForNavigation(PAGE_A);
    offerOn(PAGE_A, 'https://cdn.example.org/a.mp4');
    assert.equal(browserMediaActionService.getState().status, 'verified');

    browserMediaActionService.setActiveTab('tab-b');
    browserMediaActionService.resetForNavigation(`${PAGE_B}#t=3`);
    assert.equal(browserMediaActionService.getState().status, 'consumed');
    offerOn(PAGE_B, 'https://cdn.example.org/b.mp4');
    assert.equal(browserMediaActionService.getState().status, 'consumed');

    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.resetForNavigation(PAGE_A);
    assert.equal(browserMediaActionService.getState().status, 'verified');
    assert.equal(browserMediaActionService.getState().mediaUrl, 'https://cdn.example.org/a.mp4');
  });

  test('a real navigation after coming back still starts that tab afresh', () => {
    browserMediaActionService.setActiveTab('tab-b');
    offerOn(PAGE_B, 'https://cdn.example.org/b.mp4');
    downloadOffer('dl-b');
    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.setActiveTab('tab-b');

    browserMediaActionService.resetForNavigation('https://site-b.example.org/clip/3');
    assert.equal(browserMediaActionService.getState().status, 'idle');
    assert.equal(browserMediaActionService.getState().pageUrl, 'https://site-b.example.org/clip/3');
  });

  test('only the first report after the switch is the switch itself', () => {
    browserMediaActionService.setActiveTab('tab-b');
    offerOn(PAGE_B, 'https://cdn.example.org/b.mp4');
    browserMediaActionService.setActiveTab('tab-a');
    browserMediaActionService.setActiveTab('tab-b');
    browserMediaActionService.resetForNavigation(PAGE_B);
    assert.equal(browserMediaActionService.getState().status, 'verified');

    browserMediaActionService.resetForNavigation('https://site-b.example.org/other');
    browserMediaActionService.resetForNavigation(PAGE_B);
    assert.equal(browserMediaActionService.getState().status, 'idle');
  });
});
