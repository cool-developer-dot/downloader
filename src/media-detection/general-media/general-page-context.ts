/**
 * Ephemeral tab-scoped general page media context.
 * Never persisted to MMKV / SQLite / disk / backend.
 *
 * Phase 5A — ordinary website page/player ownership.
 * Social platforms remain owned by Phase 4A (socialPageContextStore).
 */

import { resolveSocialPlatform } from '../social/social-content-identity';
import type { ActiveVideoEvidence } from '../social/types';
import { buildGeneralCurrentMediaIdentity, extractGeneralPageVideoId } from './general-content-identity';
import { classifyGeneralContentNavigation } from './general-content-navigation';
import { stableResourcePath } from '../social-source/resource-identity';
import {
  looksLikeGeneralPlayerIframe,
  IFRAME_OWNER_MIN_INTERSECTION,
  resolveIframeOwnerStrength,
  shouldAcceptIframeAsCurrentOwner,
  type GeneralFrameClass,
  type GeneralIframePlayerEvidence,
  type GeneralOwnerStrength,
  type GeneralPlayerKind,
} from './general-embedded-player';
import {
  hashSafeId,
  logGeneralMedia,
  logGeneralOwnerTrace,
  logGeneralGenerationTrace,
} from './general-media-diagnostics';
import {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from '../services/automatic-handoff-diagnostics';
import type { GeneralPageMediaContext } from './types';

const MAX_TAB_CONTEXTS = 8;
/** How long before a recycled blob player's next source appears its library may have requested that source. */
const MSE_SOURCE_HANDOVER_MS = 4_000;
/** Keep one previous generation snapshot per tab for stale-event checks. */
const MAX_PREVIOUS_PER_TAB = 1;

const ownerListeners = new Set<() => void>();

let notifyScheduled = false;

/**
 * Owner state can change while a component renders (selection syncs a missing context), and a React
 * subscriber must never update inside another component's render. Deliver once, after the current task.
 */
function notifyOwnerListeners(): void {
  if (notifyScheduled) {
    return;
  }
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    ownerListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // presentation subscribers must not break detection
      }
    });
  });
}

type TabGeneralState = {
  current: GeneralPageMediaContext | null;
  previous: GeneralPageMediaContext[];
};

const byTab = new Map<string, TabGeneralState>();
let activeTabId: string | null = null;

function emptyTab(): TabGeneralState {
  return { current: null, previous: [] };
}

function ensure(tabId: string): TabGeneralState {
  let state = byTab.get(tabId);
  if (!state) {
    if (byTab.size >= MAX_TAB_CONTEXTS) {
      for (const key of byTab.keys()) {
        if (key !== activeTabId) {
          byTab.delete(key);
          logGeneralMedia('tab_context_cleared', { tabId: key, reason: 'lru_evict' });
          break;
        }
      }
    }
    state = emptyTab();
    byTab.set(tabId, state);
  }
  return state;
}

function pushPrevious(state: TabGeneralState, ctx: GeneralPageMediaContext): void {
  state.previous.unshift(ctx);
  if (state.previous.length > MAX_PREVIOUS_PER_TAB) {
    state.previous.length = MAX_PREVIOUS_PER_TAB;
  }
}

function resourcePathKey(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  if (url.toLowerCase().startsWith('blob:')) {
    return `blob:${url.slice(0, 48)}`;
  }
  try {
    return stableResourcePath(url);
  } catch {
    return null;
  }
}

/**
 * Detect meaningful media ownership change without treating every signed query
 * refresh as new media. Compare host+pathname only.
 */
export function didGeneralMediaResourceOwnershipChange(
  prev: string | null,
  next: string | null | undefined,
): boolean {
  if (!prev || !next) {
    return Boolean(prev || next);
  }
  if (prev === next) {
    return false;
  }
  const a = resourcePathKey(prev);
  const b = resourcePathKey(next);
  if (a && b) {
    return a !== b;
  }
  return prev !== next;
}

function buildMediaIdentity(
  elementIdentity: string | null,
  src: string | null,
  pageUrl?: string | null,
  associatedContentId?: string | null,
): string | null {
  return buildGeneralCurrentMediaIdentity({
    pageUrl,
    elementIdentity,
    src,
    associatedContentId,
  });
}

/** A rendered player below this area (CSS px²) is a thumbnail preview, never what the page URL names. */
const PAGE_ID_MIN_DISPLAY_AREA = 40_000;

/**
 * Which file a player shows, for binding the page URL's video id: the object path without host or query, so the same
 * file served by another CDN edge or with a rotated signature stays the same; a blob is its own URL.
 */
function pageIdResourceKey(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  if (url.toLowerCase().startsWith('blob:')) {
    return url.slice(0, 160);
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    // A short path (`/video.mp4`, `/stream`) names its file only together with its host and selectors.
    return parsed.pathname.length >= 12 ? parsed.pathname : resourcePathKey(url);
  } catch {
    return null;
  }
}

type PageIdBinding = {
  identity: string | null;
  pageIdResource: string | null;
};

/**
 * The current media identity on a page whose URL names a video id. That id describes the first resource the page's
 * main player showed under it; a player showing any other resource — the next reel of a viewer that never changes its
 * address, a recycled feed player, the item that was still playing when the URL switched — is identified by its own
 * element and resource, so every new video is a new offer and the previous one can never stand for it.
 */
function resolvePageIdIdentity(input: {
  current: GeneralPageMediaContext;
  pageVideoId: string;
  evidence: ActiveVideoEvidence;
  src: string | null;
  ownerStrength: GeneralOwnerStrength | null;
}): PageIdBinding {
  const { current, evidence } = input;
  const resource = pageIdResourceKey(input.src);
  let bound = current.pageIdResource ?? null;
  const excluded = current.pageIdExcludedResource ?? null;
  const pageIdentity = `video:${input.pageVideoId}`.slice(0, 160);
  const own = (): string | null =>
    buildGeneralCurrentMediaIdentity({
      pageUrl: null,
      elementIdentity: evidence.elementIdentity,
      src: input.src,
    });

  if (resource && excluded && resource === excluded) {
    return { identity: own(), pageIdResource: bound };
  }
  if (!bound) {
    const area =
      evidence.displayWidth != null && evidence.displayHeight != null
        ? evidence.displayWidth * evidence.displayHeight
        : null;
    const eligible =
      resource != null &&
      input.ownerStrength != null &&
      evidence.isDisplayed &&
      !evidence.explicitAdMarker &&
      (area == null || area <= 0 || area >= PAGE_ID_MIN_DISPLAY_AREA);
    if (eligible) {
      bound = resource;
    }
    // Nothing shown under this id yet (no source, a preview, an ad): nothing else can be what it names.
    return {
      identity: eligible || resource == null ? pageIdentity : own(),
      pageIdResource: bound,
    };
  }
  // A player with no source after the bound one (a recycled player between items) shows nothing the id names.
  const attached = resource != null && resource === bound;
  return {
    identity: attached ? pageIdentity : own(),
    pageIdResource: bound,
  };
}

function resolveVideoOwnerStrength(evidence: ActiveVideoEvidence): GeneralOwnerStrength | null {
  if (!evidence.isDisplayed || evidence.isVisibleStyle === false) {
    return null;
  }
  const ratio = evidence.intersectionRatio;
  const playing =
    evidence.recentlyPlayed || evidence.paused === false;
  if (playing && (ratio == null || ratio >= 0.35)) {
    return 'STRONG';
  }
  if (ratio == null || ratio >= 0.35 || evidence.isBlob) {
    return 'MEDIUM';
  }
  if (ratio >= 0.25) {
    return 'MEDIUM';
  }
  return null;
}

function identityKindOf(identity: string | null): string | null {
  if (!identity) {
    return null;
  }
  if (identity.startsWith('video:')) {
    return 'page-video-id';
  }
  if (identity.endsWith(':blob') || identity.includes(':blob')) {
    return 'element-blob';
  }
  return 'element-resource';
}

/**
 * Nothing of this player's video is on screen: it is not displayed, or it is wholly outside the viewport — an iframe
 * player (whose playback is not visible to the page), or a video element that is not playing. A playing video scrolled
 * out of view (the article the user reads on below it) is still the video the user is watching.
 */
function isOwnerOffScreen(
  evidence: Pick<ActiveVideoEvidence, 'isDisplayed' | 'isVisibleStyle' | 'intersectionRatio' | 'paused' | 'playerKind'>,
): boolean {
  if (!evidence.isDisplayed || evidence.isVisibleStyle === false) {
    return true;
  }
  const ratio = evidence.intersectionRatio;
  if (ratio == null) {
    return false;
  }
  // An iframe player below the share of it that makes it the page's current player at all.
  if (evidence.playerKind === 'iframe') {
    return ratio < IFRAME_OWNER_MIN_INTERSECTION;
  }
  return ratio === 0 && evidence.paused !== false;
}

/** Positively in view: displayed, and a known share of it inside the viewport (an unknown share proves nothing). */
function isOwnerOnScreen(
  evidence: Pick<ActiveVideoEvidence, 'isDisplayed' | 'isVisibleStyle' | 'intersectionRatio' | 'paused' | 'playerKind'>,
): boolean {
  return evidence.intersectionRatio != null && evidence.intersectionRatio > 0 && !isOwnerOffScreen(evidence);
}

/** The current video's own player, seen on screen before, reported itself off screen (see activeOwnerHidden). */
function markActiveOwnerHidden(tabId: string, navigationEpoch: number, elementIdentity: string | null | undefined): void {
  const state = byTab.get(tabId);
  const current = state?.current;
  if (
    !state ||
    !current ||
    !elementIdentity ||
    current.navigationEpoch !== navigationEpoch ||
    current.activeMediaElementIdentity !== elementIdentity ||
    !current.activeOwnerSeenOnScreen ||
    current.activeOwnerHidden
  ) {
    return;
  }
  state.current = { ...current, activeOwnerHidden: true };
  notifyOwnerListeners();
}

export const generalPageMediaContextStore = {
  setActiveTab(tabId: string | null): void {
    activeTabId = tabId;
  },

  getActiveTabId(): string | null {
    return activeTabId;
  },

  get(tabId: string): GeneralPageMediaContext | null {
    return byTab.get(tabId)?.current ?? null;
  },

  getActive(): GeneralPageMediaContext | null {
    if (!activeTabId) {
      return null;
    }
    return this.get(activeTabId);
  },

  /**
   * Sync page URL into general media context for a tab.
   * No-ops (clears) for social platforms — Phase 4A owns those.
   * Bumps pageGeneration on navigation or meaningful SPA path change.
   */
  syncFromPageUrl(input: {
    tabId: string;
    pageUrl: string;
    navigationEpoch: number;
  }): GeneralPageMediaContext | null {
    if (resolveSocialPlatform(input.pageUrl)) {
      this.clearTab(input.tabId);
      return null;
    }

    const state = ensure(input.tabId);
    const prev = state.current;

    const navigationChanged =
      !prev || prev.navigationEpoch !== input.navigationEpoch;
    const contentDecision =
      prev != null
        ? classifyGeneralContentNavigation(prev.pageUrl, input.pageUrl)
        : null;
    const contentChanged = Boolean(contentDecision && !contentDecision.sameContent);
    const shouldBump = navigationChanged || contentChanged;

    if (prev && contentDecision) {
      if (contentDecision.sameContent && !navigationChanged) {
        logGeneralGenerationTrace('SAME_CONTENT_IGNORED', {
          tabId: input.tabId,
          navigationEpoch: input.navigationEpoch,
          pageGeneration: prev.pageGeneration,
          oldPathClass: contentDecision.oldPathClass,
          newPathClass: contentDecision.newPathClass,
          oldIdentity: contentDecision.oldIdentity,
          newIdentity: contentDecision.newIdentity,
          didVideoIdentityChange: false,
          reason: 'same_content',
        });
      } else if (contentDecision.reason === 'spa_path' && contentChanged) {
        logGeneralGenerationTrace('SPA_CHANGE_OBSERVED', {
          tabId: input.tabId,
          navigationEpoch: input.navigationEpoch,
          oldPathClass: contentDecision.oldPathClass,
          newPathClass: contentDecision.newPathClass,
          oldIdentity: contentDecision.oldIdentity,
          newIdentity: contentDecision.newIdentity,
          didVideoIdentityChange: contentDecision.didVideoIdentityChange,
          reason: contentDecision.reason,
        });
      }
      if (shouldBump) {
        logGeneralGenerationTrace(
          contentChanged ? 'CONTENT_CHANGED' : 'GENERATION_BUMPED',
          {
            tabId: input.tabId,
            navigationEpoch: input.navigationEpoch,
            oldPathClass: contentDecision.oldPathClass,
            newPathClass: contentDecision.newPathClass,
            oldIdentity: contentDecision.oldIdentity,
            newIdentity: contentDecision.newIdentity,
            didVideoIdentityChange: contentDecision.didVideoIdentityChange,
            reason: navigationChanged ? 'navigation' : contentDecision.reason,
          },
        );
      }
    }

    if (prev && shouldBump) {
      pushPrevious(state, prev);
    }

    const next: GeneralPageMediaContext = {
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      pageGeneration: shouldBump
        ? (prev?.pageGeneration ?? 0) + 1
        : (prev?.pageGeneration ?? 1),
      pageUrl: input.pageUrl,
      activeMediaElementIdentity: shouldBump
        ? null
        : (prev?.activeMediaElementIdentity ?? null),
      activeMediaResourceIdentity: shouldBump
        ? null
        : (prev?.activeMediaResourceIdentity ?? null),
      currentMediaIdentity: shouldBump ? null : (prev?.currentMediaIdentity ?? null),
      activeVideoCurrentSrc: shouldBump ? null : (prev?.activeVideoCurrentSrc ?? null),
      activeVideoIsBlob: shouldBump ? false : (prev?.activeVideoIsBlob ?? false),
      activeVideoPlayingFiles: shouldBump ? null : (prev?.activeVideoPlayingFiles ?? null),
      activeVideoIntersectionRatio: shouldBump
        ? null
        : (prev?.activeVideoIntersectionRatio ?? null),
      activeVideoPaused: shouldBump ? null : (prev?.activeVideoPaused ?? null),
      activeVideoRecentlyPlayed: shouldBump
        ? false
        : (prev?.activeVideoRecentlyPlayed ?? false),
      activeVideoMuted: shouldBump ? null : (prev?.activeVideoMuted ?? null),
      activeVideoWidth: shouldBump ? null : (prev?.activeVideoWidth ?? null),
      activeVideoHeight: shouldBump ? null : (prev?.activeVideoHeight ?? null),
      activeVideoDisplayWidth: shouldBump ? null : (prev?.activeVideoDisplayWidth ?? null),
      activeVideoDisplayHeight: shouldBump ? null : (prev?.activeVideoDisplayHeight ?? null),
      carryFromGeneration: shouldBump ? null : (prev?.carryFromGeneration ?? null),
      carryObservedSince: shouldBump ? null : (prev?.carryObservedSince ?? null),
      explicitAdMarker: false,
      userInteractionSignal: shouldBump
        ? false
        : (prev?.userInteractionSignal ?? false),
      playerKind: shouldBump ? null : (prev?.playerKind ?? null),
      frameClass: shouldBump ? null : (prev?.frameClass ?? null),
      iframeIdentity: shouldBump ? null : (prev?.iframeIdentity ?? null),
      ownerStrength: shouldBump ? null : (prev?.ownerStrength ?? null),
      requestedMediaIdentity: shouldBump ? null : (prev?.requestedMediaIdentity ?? null),
      pageIdResource: shouldBump ? null : (prev?.pageIdResource ?? null),
      // An SPA route to another id while the previous item still plays: that item is not what the new id names.
      pageIdExcludedResource: shouldBump
        ? navigationChanged
          ? null
          : pageIdResourceKey(prev?.activeVideoCurrentSrc)
        : (prev?.pageIdExcludedResource ?? null),
      activeAssociatedContentId: shouldBump ? null : (prev?.activeAssociatedContentId ?? null),
      activeOwnerHidden: shouldBump ? false : (prev?.activeOwnerHidden ?? false),
      activeOwnerSeenOnScreen: shouldBump ? false : (prev?.activeOwnerSeenOnScreen ?? false),
      observedAt: Date.now(),
    };

    if (!prev) {
      next.pageGeneration = 1;
    }

    state.current = next;
    notifyOwnerListeners();

    logGeneralMedia(shouldBump && prev ? 'generation_changed' : 'page_context_created', {
      tabId: next.tabId,
      navigationEpoch: next.navigationEpoch,
      pageGeneration: next.pageGeneration,
      pageUrlHash: hashSafeId(next.pageUrl),
      reason: navigationChanged
        ? 'navigation'
        : contentChanged
          ? (contentDecision?.reason ?? 'spa_path')
          : 'sync',
    });

    return next;
  },

  /**
   * Apply bounded active-video evidence. May bump pageGeneration when the
   * visible player ownership clearly changes without a full navigation.
   */
  applyActiveVideoEvidence(input: {
    tabId: string;
    navigationEpoch: number;
    evidence: ActiveVideoEvidence;
  }): GeneralPageMediaContext | null {
    const state = byTab.get(input.tabId);
    const current = state?.current;
    if (!current) {
      return null;
    }
    if (current.navigationEpoch !== input.navigationEpoch) {
      logGeneralMedia('stale_candidate_ignored', {
        tabId: input.tabId,
        navigationEpoch: input.navigationEpoch,
        pageGeneration: current.pageGeneration,
        reason: 'STALE_NAVIGATION',
      });
      return current;
    }
    if (activeTabId && input.tabId !== activeTabId) {
      logGeneralMedia('stale_candidate_ignored', {
        tabId: input.tabId,
        navigationEpoch: input.navigationEpoch,
        pageGeneration: current.pageGeneration,
        reason: 'WRONG_TAB',
      });
      return current;
    }

    const prevElement = current.activeMediaElementIdentity;
    const prevSrc = current.activeVideoCurrentSrc;
    const nextSrc = input.evidence.currentSrc || input.evidence.src;
    const elementChanged =
      Boolean(prevElement) && prevElement !== input.evidence.elementIdentity;
    const srcPathChanged = didGeneralMediaResourceOwnershipChange(prevSrc, nextSrc);

    // A player is recycled only when it had a source before. An element getting its first source — a Blob built
    // from the file the page has just fetched, a lazily assigned src — is the content the page was already
    // showing, so what was observed for it must stay current.
    const recycledOwnershipChange =
      prevElement === input.evidence.elementIdentity && Boolean(prevSrc) && srcPathChanged;

    // The feed item the player shows. A report without one keeps the item the same player showed (the player is
    // between cards, nothing is laid under it for a moment) unless its source moved.
    const reportedAssociated = input.evidence.associatedContentId?.trim() || null;
    const priorAssociated = current.activeAssociatedContentId ?? null;
    const sameElement = Boolean(prevElement) && prevElement === input.evidence.elementIdentity;
    const associatedContentId =
      reportedAssociated ?? (sameElement && !srcPathChanged ? priorAssociated : null);
    // The same player now shows another feed item (an overlay player moved over the next card, a recycled iframe
    // player told to load the next video): what it showed before is not current, even with an unchanged src.
    const associatedContentChange =
      sameElement && priorAssociated != null && reportedAssociated != null && priorAssociated !== reportedAssociated;

    const visibleOwnershipChange =
      (elementChanged || recycledOwnershipChange || associatedContentChange) &&
      input.evidence.isDisplayed &&
      (input.evidence.intersectionRatio == null ||
        input.evidence.intersectionRatio >= 0.35);

    const shouldBump = Boolean(
      visibleOwnershipChange &&
        (recycledOwnershipChange || elementChanged || associatedContentChange),
    );

    if (shouldBump && state) {
      pushPrevious(state, current);
    }

    const resourceIdentity = resourcePathKey(nextSrc);
    const evidencePageUrl = input.evidence.pageUrl || current.pageUrl;
    const pageVideoId = extractGeneralPageVideoId(evidencePageUrl);

    const userInteraction =
      input.evidence.recentlyPlayed ||
      (input.evidence.paused === false && input.evidence.isDisplayed);

    const playerKind: GeneralPlayerKind =
      input.evidence.playerKind === 'iframe' ? 'iframe' : 'video';
    const frameClass: GeneralFrameClass =
      input.evidence.frameClass ?? (playerKind === 'iframe' ? 'cross-origin' : 'top');

    const ownerStrength =
      playerKind === 'iframe'
        ? resolveIframeOwnerStrength({
            looksPlayer: true,
            isDisplayed: input.evidence.isDisplayed,
            intersectionRatio: input.evidence.intersectionRatio,
            recentlyPlayed: input.evidence.recentlyPlayed,
          })
        : resolveVideoOwnerStrength(input.evidence);

    if (
      playerKind === 'iframe' &&
      !shouldAcceptIframeAsCurrentOwner({
        looksPlayer: true,
        isDisplayed: input.evidence.isDisplayed,
        isVisibleStyle: input.evidence.isVisibleStyle,
        intersectionRatio: input.evidence.intersectionRatio,
        width: input.evidence.videoWidth,
        height: input.evidence.videoHeight,
      })
    ) {
      logGeneralOwnerTrace('GENERAL_OWNER_REJECTED', {
        tabId: current.tabId,
        pageGeneration: current.pageGeneration,
        playerKind: 'iframe',
        frameClass,
        reason: 'HIDDEN_VIDEO',
      });
      if (isOwnerOffScreen(input.evidence)) {
        markActiveOwnerHidden(input.tabId, input.navigationEpoch, input.evidence.elementIdentity);
      }
      return this.get(input.tabId);
    }

    if (playerKind === 'video' && !input.evidence.isDisplayed && !input.evidence.recentlyPlayed) {
      // Hidden/offscreen video must not become a strong general owner.
      if (ownerStrength == null) {
        logGeneralOwnerTrace('GENERAL_OWNER_REJECTED', {
          tabId: current.tabId,
          pageGeneration: current.pageGeneration,
          playerKind: 'video',
          frameClass,
          reason: 'HIDDEN_VIDEO',
        });
        markActiveOwnerHidden(input.tabId, input.navigationEpoch, input.evidence.elementIdentity);
        return this.get(input.tabId);
      }
    }

    const binding = pageVideoId
      ? resolvePageIdIdentity({ current, pageVideoId, evidence: input.evidence, src: nextSrc, ownerStrength })
      : null;
    const mediaIdentity =
      binding?.identity ??
      buildMediaIdentity(
        input.evidence.elementIdentity,
        nextSrc,
        evidencePageUrl,
        associatedContentId,
      );

    // Off screen only after having been on screen: the same player, seen before, now out of view.
    const ownerOffScreen = isOwnerOffScreen(input.evidence);
    const ownerSeenBefore = sameElement && Boolean(current.activeOwnerSeenOnScreen);
    const prevIdentity = current.currentMediaIdentity;
    // A resource the user asked for stays current while the player keeps showing what it showed then.
    const requestedMediaIdentity = shouldBump ? null : (current.requestedMediaIdentity ?? null);
    const next: GeneralPageMediaContext = {
      ...current,
      pageIdResource: binding ? binding.pageIdResource : (current.pageIdResource ?? null),
      activeAssociatedContentId: associatedContentId,
      activeOwnerHidden: ownerOffScreen && ownerSeenBefore,
      activeOwnerSeenOnScreen: isOwnerOnScreen(input.evidence) || ownerSeenBefore,
      pageUrl: input.evidence.pageUrl || current.pageUrl,
      activeMediaElementIdentity: input.evidence.elementIdentity,
      activeMediaResourceIdentity: resourceIdentity,
      currentMediaIdentity: requestedMediaIdentity ?? mediaIdentity,
      requestedMediaIdentity,
      activeVideoCurrentSrc: nextSrc,
      activeVideoIsBlob: input.evidence.isBlob,
      activeVideoPlayingFiles: input.evidence.isBlob ? (input.evidence.playingFiles ?? null) : null,
      activeVideoIntersectionRatio: input.evidence.intersectionRatio,
      activeVideoPaused: input.evidence.paused,
      activeVideoRecentlyPlayed: input.evidence.recentlyPlayed,
      activeVideoMuted: input.evidence.muted,
      activeVideoWidth: input.evidence.videoWidth,
      activeVideoHeight: input.evidence.videoHeight,
      activeVideoDisplayWidth: input.evidence.displayWidth ?? null,
      activeVideoDisplayHeight: input.evidence.displayHeight ?? null,
      explicitAdMarker: input.evidence.explicitAdMarker,
      userInteractionSignal: userInteraction,
      playerKind,
      frameClass,
      iframeIdentity: playerKind === 'iframe' ? input.evidence.elementIdentity : current.iframeIdentity ?? null,
      ownerStrength,
      pageGeneration: shouldBump
        ? current.pageGeneration + 1
        : current.pageGeneration,
      // The player's library requested the next item's source moments before it showed it (a recycled blob, an
      // iframe player given the next video): requests of the previous generation just before the change carry over.
      ...(shouldBump
        ? (recycledOwnershipChange && input.evidence.isBlob) || (associatedContentChange && !elementChanged)
          ? {
              carryFromGeneration: current.pageGeneration,
              carryObservedSince: Date.now() - MSE_SOURCE_HANDOVER_MS,
            }
          : { carryFromGeneration: null, carryObservedSince: null }
        : null),
      observedAt: input.evidence.observedAt,
    };

    if (state) {
      state.current = next;
    }

    const ownershipRelevant =
      current.pageGeneration !== next.pageGeneration ||
      current.currentMediaIdentity !== next.currentMediaIdentity ||
      current.activeMediaElementIdentity !== next.activeMediaElementIdentity ||
      current.activeVideoCurrentSrc !== next.activeVideoCurrentSrc ||
      current.activeVideoIsBlob !== next.activeVideoIsBlob ||
      current.activeVideoPaused !== next.activeVideoPaused ||
      current.activeVideoRecentlyPlayed !== next.activeVideoRecentlyPlayed ||
      current.ownerStrength !== next.ownerStrength ||
      current.playerKind !== next.playerKind ||
      Boolean(current.activeOwnerHidden) !== Boolean(next.activeOwnerHidden);
    if (ownershipRelevant) {
      notifyOwnerListeners();
      const kind = identityKindOf(next.currentMediaIdentity);
      if (current.currentMediaIdentity !== next.currentMediaIdentity) {
        logAutomaticHandoff('CONTENT_IDENTITY_CHANGED', {
          tabId: next.tabId,
          contentIdentityHash: hashHandoffIdentity(next.currentMediaIdentity),
          priorIdentityHash: hashHandoffIdentity(current.currentMediaIdentity),
          scope: 'general',
        });
      }
      if (current.ownerStrength !== next.ownerStrength) {
        logAutomaticHandoff('VIDEO_OWNER_OBSERVED', {
          tabId: next.tabId,
          contentIdentityHash: hashHandoffIdentity(next.currentMediaIdentity),
          ownerStrength: next.ownerStrength,
          playerKind: next.playerKind,
          isBlob: next.activeVideoIsBlob,
        });
      }
      logGeneralOwnerTrace(
        next.playerKind === 'iframe'
          ? 'GENERAL_IFRAME_PLAYER_DISCOVERED'
          : 'GENERAL_VIDEO_DISCOVERED',
        {
          tabId: next.tabId,
          pageGeneration: next.pageGeneration,
          ownerStrength: next.ownerStrength,
          playerKind: next.playerKind,
          identityKind: kind,
          frameClass: next.frameClass,
        },
      );

      logGeneralMedia('media_element_seen', {
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        pageGeneration: next.pageGeneration,
        mediaIdentityHash: hashSafeId(next.currentMediaIdentity),
        isBlob: next.activeVideoIsBlob,
        intersectionRatio: next.activeVideoIntersectionRatio,
        playerKind: next.playerKind,
        frameClass: next.frameClass,
        ownerStrength: next.ownerStrength,
        identityKind: kind,
      });

      if (
        next.activeVideoRecentlyPlayed ||
        next.activeVideoPaused === false ||
        next.playerKind === 'iframe'
      ) {
        logGeneralMedia('media_element_active', {
          tabId: next.tabId,
          navigationEpoch: next.navigationEpoch,
          pageGeneration: next.pageGeneration,
          mediaIdentityHash: hashSafeId(next.currentMediaIdentity),
          isBlob: next.activeVideoIsBlob,
          intersectionRatio: next.activeVideoIntersectionRatio,
        });
        logGeneralOwnerTrace('GENERAL_PLAYER_DISCOVERED', {
          tabId: next.tabId,
          pageGeneration: next.pageGeneration,
          ownerStrength: next.ownerStrength,
          playerKind: next.playerKind,
          identityKind: kind,
          frameClass: next.frameClass,
        });
      }
    }

    const kind = identityKindOf(next.currentMediaIdentity);

    if (next.activeVideoIsBlob) {
      logGeneralMedia('blob_clue', {
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        pageGeneration: next.pageGeneration,
        mediaIdentityHash: hashSafeId(next.activeMediaElementIdentity),
        isBlob: true,
      });
    }

    if (!prevIdentity && next.currentMediaIdentity) {
      logGeneralOwnerTrace('GENERAL_OWNER_ACQUIRED', {
        tabId: next.tabId,
        pageGeneration: next.pageGeneration,
        ownerStrength: next.ownerStrength,
        playerKind: next.playerKind,
        identityKind: kind,
        frameClass: next.frameClass,
      });
    } else if (
      prevIdentity &&
      next.currentMediaIdentity &&
      prevIdentity !== next.currentMediaIdentity
    ) {
      logGeneralOwnerTrace('GENERAL_OWNER_CHANGED', {
        tabId: next.tabId,
        pageGeneration: next.pageGeneration,
        ownerStrength: next.ownerStrength,
        playerKind: next.playerKind,
        identityKind: kind,
        frameClass: next.frameClass,
      });
    }

    if (shouldBump) {
      logGeneralMedia('generation_changed', {
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        pageGeneration: next.pageGeneration,
        reason: recycledOwnershipChange
          ? 'recycled_player'
          : 'active_video_ownership',
      });
    }

    return next;
  },

  /**
   * Visible embedded iframe player — no cross-origin DOM read.
   * Same-origin inner <video> still arrives via active_video.
   */
  applyActiveIframePlayerEvidence(input: {
    tabId: string;
    navigationEpoch: number;
    evidence: GeneralIframePlayerEvidence & {
      pageUrl: string;
      associatedContentId?: string | null;
      observedAt?: number;
    };
  }): GeneralPageMediaContext | null {
    const looksPlayer =
      input.evidence.looksPlayer ||
      looksLikeGeneralPlayerIframe({
        src: input.evidence.iframeSrc,
        width: input.evidence.width,
        height: input.evidence.height,
        isDisplayed: input.evidence.isDisplayed,
        allowFullscreen: input.evidence.allowFullscreen,
        allow: input.evidence.allow,
      });

    if (
      !shouldAcceptIframeAsCurrentOwner({
        looksPlayer,
        isDisplayed: input.evidence.isDisplayed,
        isVisibleStyle: input.evidence.isVisibleStyle,
        intersectionRatio: input.evidence.intersectionRatio,
        width: input.evidence.width,
        height: input.evidence.height,
        sameOriginVideoCount: input.evidence.sameOriginVideoCount,
      })
    ) {
      logGeneralOwnerTrace('GENERAL_OWNER_REJECTED', {
        tabId: input.tabId,
        playerKind: 'iframe',
        frameClass: input.evidence.frameClass,
        reason: input.evidence.isDisplayed ? 'LOW_CORRELATION' : 'HIDDEN_VIDEO',
      });
      if (isOwnerOffScreen({ ...input.evidence, paused: null, playerKind: 'iframe' })) {
        markActiveOwnerHidden(input.tabId, input.navigationEpoch, input.evidence.iframeIdentity);
      }
      return this.get(input.tabId);
    }

    const videoEvidence: ActiveVideoEvidence = {
      pageUrl: input.evidence.pageUrl,
      elementIdentity: input.evidence.iframeIdentity,
      currentSrc: input.evidence.iframeSrc,
      src: input.evidence.iframeSrc,
      isBlob: false,
      paused: null,
      ended: null,
      readyState: null,
      videoWidth: input.evidence.width,
      videoHeight: input.evidence.height,
      muted: null,
      currentTimeBucket: null,
      intersectionRatio: input.evidence.intersectionRatio,
      viewportCenterDistance: null,
      isDisplayed: input.evidence.isDisplayed,
      isVisibleStyle: input.evidence.isVisibleStyle,
      recentlyPlayed:
        looksPlayer &&
        input.evidence.isDisplayed &&
        (input.evidence.intersectionRatio == null ||
          input.evidence.intersectionRatio >= 0.35),
      explicitAdMarker: false,
      associatedContentId: input.evidence.associatedContentId ?? null,
      observedAt: input.evidence.observedAt ?? Date.now(),
      playerKind: 'iframe',
      frameClass: input.evidence.frameClass,
    };

    return this.applyActiveVideoEvidence({
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      evidence: videoEvidence,
    });
  },

  isStaleGeneration(
    tabId: string,
    navigationEpoch: number,
    pageGeneration: number,
  ): boolean {
    const current = byTab.get(tabId)?.current;
    if (!current) {
      return true;
    }
    if (current.navigationEpoch !== navigationEpoch) {
      return true;
    }
    return pageGeneration !== current.pageGeneration;
  },

  /**
   * The user asked the browser for this exact resource on the current page (a WebView download). It becomes the
   * page's current media — a new generation, so work started for the previous one is stale — whatever the page's
   * player is showing, until that player moves to another element or source.
   */
  adoptUserRequestedMedia(input: {
    tabId: string;
    navigationEpoch: number;
    mediaUrl: string;
  }): GeneralPageMediaContext | null {
    const state = byTab.get(input.tabId);
    const current = state?.current;
    if (!state || !current || current.navigationEpoch !== input.navigationEpoch) {
      return null;
    }
    const identity = `requested:${resourcePathKey(input.mediaUrl) ?? input.mediaUrl}`;
    if (current.requestedMediaIdentity === identity && current.currentMediaIdentity === identity) {
      return current;
    }
    pushPrevious(state, current);
    const next: GeneralPageMediaContext = {
      ...current,
      currentMediaIdentity: identity,
      requestedMediaIdentity: identity,
      activeOwnerHidden: false,
      pageGeneration: current.pageGeneration + 1,
      carryFromGeneration: null,
      carryObservedSince: null,
      observedAt: Date.now(),
    };
    state.current = next;
    notifyOwnerListeners();
    logGeneralMedia('generation_changed', {
      tabId: next.tabId,
      navigationEpoch: next.navigationEpoch,
      pageGeneration: next.pageGeneration,
      pageUrlHash: hashSafeId(next.pageUrl),
      reason: 'user_requested_media',
    });
    return next;
  },

  clearTab(tabId: string): void {
    if (byTab.has(tabId)) {
      byTab.delete(tabId);
      logGeneralMedia('tab_context_cleared', { tabId, reason: 'clear_tab' });
      notifyOwnerListeners();
    }
  },

  clearAll(): void {
    byTab.clear();
    notifyOwnerListeners();
  },

  subscribe(listener: () => void): () => void {
    ownerListeners.add(listener);
    return () => {
      ownerListeners.delete(listener);
    };
  },

  /** Test/diagnostics — number of retained tab contexts. */
  size(): number {
    return byTab.size;
  },
};
