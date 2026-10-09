/**
 * When a verified direct-analysis result may become the tab's "Video available" offer. The result belongs to one
 * pasted link in one tab: it is published only while that tab shows that link's page (or where it redirected), after
 * the detection pipeline has started that navigation (so the navigation reset cannot wipe it), and never over an offer
 * the WebView pipeline already published — that one describes what is playing. Pure, so every rule is testable.
 */

import { extractGeneralPageVideoId } from '../general-media/general-content-identity';
import {
  extractSocialContentIdentity,
  resolveContentIdentityKey,
  resolveSocialPlatform,
} from '../social/social-content-identity';
import { isSameDocumentUrl } from '../utils/url';

import { valueNamesToken } from './content-tokens';

export type DirectOfferSlice = {
  status: string;
  contentIdentity: string | null;
  selectionLocked: boolean;
};

export type DirectPublishInput = {
  sessionTabId: string;
  activeTabId: string | null;
  tabExists: boolean;
  /** The session tab's current URL (browser store). */
  tabUrl: string | null;
  /** The detection pipeline's current navigation (the active tab's). */
  lastNavigation: string | null;
  /** The pasted link, where it redirected, and the page's canonical URL. */
  pageUrls: readonly string[];
  contentTokens: ReadonlySet<string>;
  /** The tab has shown the session's page at least once since the paste. */
  navigationSeen: boolean;
  offer: DirectOfferSlice;
  offerIdentity: string | null;
  /**
   * What the tab's player shows right now, as the WebView pipeline identifies it (null before any player evidence).
   * A feed or reel viewer can move on to other videos under the pasted link's URL.
   */
  liveMediaIdentity?: string | null;
  identityConsumed: boolean;
};

export type DirectPublishDecision =
  | { action: 'publish' }
  | { action: 'wait'; reason: 'NAVIGATION_PENDING' | 'TAB_NOT_ACTIVE' | 'DETECTION_NAVIGATION_PENDING' }
  | { action: 'stale'; reason: 'CLOSED_TAB' | 'NAVIGATED_AWAY' | 'OTHER_MEDIA_PLAYING' }
  | { action: 'skip'; reason: 'ALREADY_CONSUMED' | 'ALREADY_OFFERED' | 'WEBVIEW_OFFER_PRESENT' };

function siteOf(url: string): string | null {
  try {
    const labels = new URL(url).hostname.toLowerCase().split('.');
    return labels.slice(-2).join('.');
  } catch {
    return null;
  }
}

/** Whether `url` is the session's page: the same document, or the same site naming the same content id. */
export function matchesDirectPage(
  url: string | null | undefined,
  pageUrls: readonly string[],
  tokens: ReadonlySet<string>,
): boolean {
  if (!url) {
    return false;
  }
  if (pageUrls.some((page) => isSameDocumentUrl(url, page))) {
    return true;
  }
  const site = siteOf(url);
  return site != null && pageUrls.some((page) => siteOf(page) === site) && valueNamesToken(url, tokens);
}

/**
 * The content identity the WebView pipeline gives the same page, so its later detection of the same video keeps this
 * offer (sticky AVAILABLE) instead of replacing it: `platform:type:id` on social pages, `video:<id>` on pages whose
 * URL names a video id, else none (the offer is then identified by its media fingerprint).
 */
export function directOfferIdentity(pageUrl: string): string | null {
  if (resolveSocialPlatform(pageUrl)) {
    const identity = extractSocialContentIdentity(pageUrl);
    return identity ? resolveContentIdentityKey(identity) : null;
  }
  const id = extractGeneralPageVideoId(pageUrl);
  return id ? `video:${id}`.slice(0, 160) : null;
}

/** Whether the player's current media is known and is not the video `offerIdentity` names. */
export function isOtherMediaPlaying(
  offerIdentity: string | null | undefined,
  liveMediaIdentity: string | null | undefined,
): boolean {
  return Boolean(offerIdentity && liveMediaIdentity && offerIdentity !== liveMediaIdentity);
}

// `failed` is an offer too (AVAILABLE again after a failed tap).
const LIVE_OFFER_STATUSES = new Set(['verified', 'failed', 'preparing', 'consumed', 'downloading', 'completed']);

export function decideDirectPublish(input: DirectPublishInput): DirectPublishDecision {
  if (!input.tabExists) {
    return { action: 'stale', reason: 'CLOSED_TAB' };
  }
  if (!matchesDirectPage(input.tabUrl, input.pageUrls, input.contentTokens)) {
    return input.navigationSeen
      ? { action: 'stale', reason: 'NAVIGATED_AWAY' }
      : { action: 'wait', reason: 'NAVIGATION_PENDING' };
  }
  if (input.activeTabId !== input.sessionTabId) {
    return { action: 'wait', reason: 'TAB_NOT_ACTIVE' };
  }
  if (!matchesDirectPage(input.lastNavigation, input.pageUrls, input.contentTokens)) {
    return { action: 'wait', reason: 'DETECTION_NAVIGATION_PENDING' };
  }
  // The page's player already shows another video (the next reel, a feed item): the pasted link's file is not it.
  if (isOtherMediaPlaying(input.offerIdentity, input.liveMediaIdentity)) {
    return { action: 'stale', reason: 'OTHER_MEDIA_PLAYING' };
  }
  if (input.identityConsumed) {
    return { action: 'skip', reason: 'ALREADY_CONSUMED' };
  }
  if (LIVE_OFFER_STATUSES.has(input.offer.status) || input.offer.selectionLocked) {
    return input.offerIdentity != null && input.offer.contentIdentity === input.offerIdentity
      ? { action: 'skip', reason: 'ALREADY_OFFERED' }
      : { action: 'skip', reason: 'WEBVIEW_OFFER_PRESENT' };
  }
  return { action: 'publish' };
}
