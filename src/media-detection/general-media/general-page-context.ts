/**
 * Ephemeral tab-scoped general page media context.
 * Never persisted to MMKV / SQLite / disk / backend.
 *
 * Phase 5A — ordinary website page/player ownership.
 * Social platforms remain owned by Phase 4A (socialPageContextStore).
 */

import { resolveSocialPlatform } from '../social/social-content-identity';
import type { ActiveVideoEvidence } from '../social/types';
import { buildGeneralCurrentMediaIdentity } from './general-content-identity';
import { classifyGeneralContentNavigation } from './general-content-navigation';
import { stableResourcePath } from '../social-source/resource-identity';
import {
  looksLikeGeneralPlayerIframe,
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
      explicitAdMarker: false,
      userInteractionSignal: shouldBump
        ? false
        : (prev?.userInteractionSignal ?? false),
      playerKind: shouldBump ? null : (prev?.playerKind ?? null),
      frameClass: shouldBump ? null : (prev?.frameClass ?? null),
      iframeIdentity: shouldBump ? null : (prev?.iframeIdentity ?? null),
      ownerStrength: shouldBump ? null : (prev?.ownerStrength ?? null),
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

    const visibleOwnershipChange =
      (elementChanged || recycledOwnershipChange) &&
      input.evidence.isDisplayed &&
      (input.evidence.intersectionRatio == null ||
        input.evidence.intersectionRatio >= 0.35);

    const shouldBump = Boolean(
      visibleOwnershipChange &&
        (recycledOwnershipChange || elementChanged),
    );

    if (shouldBump && state) {
      pushPrevious(state, current);
    }

    const resourceIdentity = resourcePathKey(nextSrc);
    const mediaIdentity = buildMediaIdentity(
      input.evidence.elementIdentity,
      nextSrc,
      input.evidence.pageUrl || current.pageUrl,
      input.evidence.associatedContentId,
    );

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
      return current;
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
        return current;
      }
    }

    const prevIdentity = current.currentMediaIdentity;
    const next: GeneralPageMediaContext = {
      ...current,
      pageUrl: input.evidence.pageUrl || current.pageUrl,
      activeMediaElementIdentity: input.evidence.elementIdentity,
      activeMediaResourceIdentity: resourceIdentity,
      currentMediaIdentity: mediaIdentity,
      activeVideoCurrentSrc: nextSrc,
      activeVideoIsBlob: input.evidence.isBlob,
      activeVideoIntersectionRatio: input.evidence.intersectionRatio,
      activeVideoPaused: input.evidence.paused,
      activeVideoRecentlyPlayed: input.evidence.recentlyPlayed,
      activeVideoMuted: input.evidence.muted,
      activeVideoWidth: input.evidence.videoWidth,
      activeVideoHeight: input.evidence.videoHeight,
      explicitAdMarker: input.evidence.explicitAdMarker,
      userInteractionSignal: userInteraction,
      playerKind,
      frameClass,
      iframeIdentity: playerKind === 'iframe' ? input.evidence.elementIdentity : current.iframeIdentity ?? null,
      ownerStrength,
      pageGeneration: shouldBump
        ? current.pageGeneration + 1
        : current.pageGeneration,
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
      current.playerKind !== next.playerKind;
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
