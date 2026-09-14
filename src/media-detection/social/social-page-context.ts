/**
 * Ephemeral tab-scoped social page context.
 * Never persisted to MMKV / SQLite / disk / backend.
 */

import { extractSocialContentIdentity, resolveContentIdentityKey, resolveSocialPlatform } from './social-content-identity';
import { sanitizeInstagramShortcode } from './instagram-content-identity';
import { sanitizeTikTokVideoId } from './tiktok-content-identity';
import { logSocialCorrelation } from './social-correlation-diagnostics';
import type { ActiveVideoEvidence, SocialPageContext } from './types';
import { isSameDocumentUrl } from '../utils';

const MAX_TAB_CONTEXTS = 8;
/** Keep one previous generation snapshot per tab for stale-event checks. */
const MAX_PREVIOUS_PER_TAB = 1;

const ownerListeners = new Set<() => void>();

function notifyOwnerListeners(): void {
  ownerListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // presentation subscribers must not break detection
    }
  });
}

type TabSocialState = {
  current: SocialPageContext | null;
  previous: SocialPageContext[];
};

const byTab = new Map<string, TabSocialState>();
let activeTabId: string | null = null;

function emptyTab(): TabSocialState {
  return { current: null, previous: [] };
}

function ensure(tabId: string): TabSocialState {
  let state = byTab.get(tabId);
  if (!state) {
    if (byTab.size >= MAX_TAB_CONTEXTS) {
      // Evict oldest non-active tab.
      for (const key of byTab.keys()) {
        if (key !== activeTabId) {
          byTab.delete(key);
          break;
        }
      }
    }
    state = emptyTab();
    byTab.set(tabId, state);
  }
  return state;
}

function pushPrevious(state: TabSocialState, ctx: SocialPageContext): void {
  state.previous.unshift(ctx);
  if (state.previous.length > MAX_PREVIOUS_PER_TAB) {
    state.previous.length = MAX_PREVIOUS_PER_TAB;
  }
}

function buildEphemeralId(evidence: ActiveVideoEvidence | null): string | null {
  if (!evidence) {
    return null;
  }
  const src = evidence.currentSrc || evidence.src || '';
  let pathKey = evidence.elementIdentity;
  if (src && !src.toLowerCase().startsWith('blob:')) {
    try {
      const u = new URL(src);
      pathKey = `${evidence.elementIdentity}:${u.hostname}${u.pathname}`.slice(0, 120);
    } catch {
      pathKey = `${evidence.elementIdentity}:${src.slice(0, 64)}`;
    }
  } else if (src.toLowerCase().startsWith('blob:')) {
    // Recycled players often keep the same <video> element with a new blob URL.
    // Collapsing to `vN:blob` made Media A CONSUMED suppress B/C/D incorrectly.
    const assoc = evidence.associatedContentId?.trim();
    if (assoc) {
      pathKey = `${evidence.elementIdentity}:blob:${assoc}`;
    } else {
      const blobTail = src.replace(/^blob:/i, '').slice(-48);
      pathKey = `${evidence.elementIdentity}:blob:${blobTail}`;
    }
  }
  return pathKey.slice(0, 160);
}

function sanitizeAssociatedContentId(
  platform: 'instagram' | 'tiktok',
  raw: string | null,
): string | null {
  if (platform === 'instagram') {
    return sanitizeInstagramShortcode(raw);
  }
  return sanitizeTikTokVideoId(raw);
}

export const socialPageContextStore = {
  setActiveTab(tabId: string | null): void {
    activeTabId = tabId;
  },

  getActiveTabId(): string | null {
    return activeTabId;
  },

  get(tabId: string): SocialPageContext | null {
    return byTab.get(tabId)?.current ?? null;
  },

  getActive(): SocialPageContext | null {
    if (!activeTabId) {
      return null;
    }
    return this.get(activeTabId);
  },

  /**
   * Sync page URL into social context for a tab.
   * Bumps contextGeneration when content identity changes.
   */
  syncFromPageUrl(input: {
    tabId: string;
    pageUrl: string;
    navigationEpoch: number;
  }): SocialPageContext | null {
    const platform = resolveSocialPlatform(input.pageUrl);
    if (!platform) {
      this.clearTab(input.tabId);
      return null;
    }

    const identity = extractSocialContentIdentity(input.pageUrl);
    if (!identity) {
      this.clearTab(input.tabId);
      return null;
    }

    const state = ensure(input.tabId);
    const prev = state.current;

    // /foryou (and other feed surfaces) must not wipe a stronger item id already
    // bound from the visible player. The page URL is not the content identity.
    if (
      prev &&
      prev.navigationEpoch === input.navigationEpoch &&
      prev.platform === identity.platform &&
      !identity.canonicalContentId &&
      isSameDocumentUrl(prev.pageUrl, input.pageUrl) &&
      Boolean(prev.canonicalContentId || prev.currentVisibleMediaIdentity)
    ) {
      return prev;
    }
    const contentChanged =
      !prev ||
      prev.platform !== identity.platform ||
      prev.canonicalContentId !== identity.canonicalContentId ||
      // SPA feed URL change with null ids (legacy) OR any distinct page URL while
      // both lack STRONG ids — same navigationEpoch is normal for pushState/replaceState.
      (identity.canonicalContentId == null &&
        Boolean(prev.canonicalContentId == null) &&
        prev.pageUrl !== input.pageUrl);

    // Full navigation always invalidates prior social generation.
    const navigationChanged =
      !prev || prev.navigationEpoch !== input.navigationEpoch;

    const shouldBump = contentChanged || navigationChanged;

    if (prev && shouldBump) {
      pushPrevious(state, prev);
    }

    const next: SocialPageContext = {
      tabId: input.tabId,
      navigationEpoch: input.navigationEpoch,
      platform: identity.platform,
      pageUrl: input.pageUrl,
      canonicalPageUrl: identity.canonicalPageUrl,
      contentType: identity.contentType,
      canonicalContentId: identity.canonicalContentId,
      ephemeralContentId: shouldBump
        ? null
        : (prev?.ephemeralContentId ?? null),
      activeVideoElementIdentity: shouldBump
        ? null
        : (prev?.activeVideoElementIdentity ?? null),
      currentVisibleMediaIdentity: shouldBump
        ? null
        : (prev?.currentVisibleMediaIdentity ?? null),
      activeVideoCurrentSrc: shouldBump ? null : (prev?.activeVideoCurrentSrc ?? null),
      activeVideoIsBlob: shouldBump ? false : (prev?.activeVideoIsBlob ?? false),
      activeVideoIntersectionRatio: shouldBump
        ? null
        : (prev?.activeVideoIntersectionRatio ?? null),
      activeVideoPaused: shouldBump ? null : (prev?.activeVideoPaused ?? null),
      activeVideoRecentlyPlayed: shouldBump
        ? false
        : (prev?.activeVideoRecentlyPlayed ?? false),
      explicitAdMarker: false,
      contextGeneration: shouldBump
        ? (prev?.contextGeneration ?? 0) + 1
        : (prev?.contextGeneration ?? 1),
      identityConfidence: identity.identityConfidence,
      observedAt: Date.now(),
    };

    // First create starts at generation 1.
    if (!prev) {
      next.contextGeneration = 1;
    }

    state.current = next;
    notifyOwnerListeners();

    logSocialCorrelation(shouldBump && prev ? 'context_changed' : 'context_created', {
      platform: next.platform,
      tabId: next.tabId,
      navigationEpoch: next.navigationEpoch,
      contextGeneration: next.contextGeneration,
      contentId: next.canonicalContentId,
      contentType: next.contentType,
    });

    if (next.canonicalContentId) {
      logSocialCorrelation('content_id_detected', {
        platform: next.platform,
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        contextGeneration: next.contextGeneration,
        contentId: next.canonicalContentId,
      });
    }

    return next;
  },

  /**
   * Apply bounded active-video evidence. May bump generation when the visible
   * player ownership clearly changes without a route change (feed swipe).
   */
  applyActiveVideoEvidence(input: {
    tabId: string;
    navigationEpoch: number;
    evidence: ActiveVideoEvidence;
  }): SocialPageContext | null {
    const state = byTab.get(input.tabId);
    const current = state?.current;
    if (!current) {
      return null;
    }
    if (current.navigationEpoch !== input.navigationEpoch) {
      logSocialCorrelation('stale_event_ignored', {
        platform: current.platform,
        tabId: input.tabId,
        navigationEpoch: input.navigationEpoch,
        contextGeneration: current.contextGeneration,
        reason: 'STALE_NAVIGATION',
      });
      return current;
    }
    if (activeTabId && input.tabId !== activeTabId) {
      logSocialCorrelation('tab_mismatch_rejected', {
        platform: current.platform,
        tabId: input.tabId,
        navigationEpoch: input.navigationEpoch,
        contextGeneration: current.contextGeneration,
        reason: 'WRONG_TAB',
      });
      return current;
    }

    const associated = sanitizeAssociatedContentId(
      current.platform,
      input.evidence.associatedContentId,
    );

    // Prefer route id; DOM-associated id can upgrade feed → concrete content.
    let contentId = current.canonicalContentId;
    let contentType = current.contentType;
    let identityConfidence = current.identityConfidence;
    let contentChanged = false;

    if (!contentId && associated) {
      contentId = associated;
      contentType =
        current.platform === 'instagram' ? 'instagram_feed_video' : 'tiktok_feed_video';
      identityConfidence = 'MEDIUM';
      contentChanged = true;
    } else if (
      contentId &&
      associated &&
      associated !== contentId &&
      // Only allow DOM id to replace when route lacked id or feed ephemeral.
      current.identityConfidence !== 'STRONG'
    ) {
      contentId = associated;
      contentChanged = true;
    }

    const prevElement = current.activeVideoElementIdentity;
    const prevSrc = current.activeVideoCurrentSrc;
    const nextSrc = input.evidence.currentSrc || input.evidence.src;
    const elementChanged =
      Boolean(prevElement) &&
      prevElement !== input.evidence.elementIdentity;
    const srcPathChanged = didMediaResourceOwnershipChange(prevSrc, nextSrc);

    // Recycled DOM node: same element, different media → ownership change.
    const recycledOwnershipChange =
      prevElement === input.evidence.elementIdentity && srcPathChanged;

    // Element change requires visibility threshold. Recycled same-element src
    // change must bump even mid-swipe (ratio < 0.35) — otherwise the first
    // below-threshold event writes the new src and the fully-visible follow-up
    // never sees srcPathChanged, permanently stalling contextGeneration.
    const visibleOwnershipChange =
      input.evidence.isDisplayed &&
      ((elementChanged &&
        (input.evidence.intersectionRatio == null ||
          input.evidence.intersectionRatio >= 0.35)) ||
        recycledOwnershipChange);

    const shouldBump =
      contentChanged ||
      (visibleOwnershipChange &&
        (contentId == null || contentChanged || recycledOwnershipChange));

    if (shouldBump && state) {
      pushPrevious(state, current);
    }

    const ephemeral =
      contentId == null
        ? buildEphemeralId(input.evidence)
        : current.ephemeralContentId;

    const next: SocialPageContext = {
      ...current,
      canonicalContentId: contentId,
      contentType,
      identityConfidence,
      ephemeralContentId: ephemeral,
      activeVideoElementIdentity: input.evidence.elementIdentity,
      currentVisibleMediaIdentity: resolveContentIdentityKey(
        {
          platform: current.platform,
          contentType,
          canonicalContentId: contentId,
          canonicalPageUrl: current.canonicalPageUrl,
          identityConfidence,
        },
        ephemeral,
      ),
      activeVideoCurrentSrc: nextSrc,
      activeVideoIsBlob: input.evidence.isBlob,
      activeVideoIntersectionRatio: input.evidence.intersectionRatio,
      activeVideoPaused: input.evidence.paused,
      activeVideoRecentlyPlayed: input.evidence.recentlyPlayed,
      explicitAdMarker: input.evidence.explicitAdMarker,
      contextGeneration: shouldBump
        ? current.contextGeneration + 1
        : current.contextGeneration,
      observedAt: input.evidence.observedAt,
      pageUrl: input.evidence.pageUrl || current.pageUrl,
    };

    if (state) {
      state.current = next;
    }

    const ownershipRelevant =
      current.contextGeneration !== next.contextGeneration ||
      current.currentVisibleMediaIdentity !== next.currentVisibleMediaIdentity ||
      current.canonicalContentId !== next.canonicalContentId ||
      current.activeVideoElementIdentity !== next.activeVideoElementIdentity ||
      current.activeVideoCurrentSrc !== next.activeVideoCurrentSrc ||
      current.activeVideoIsBlob !== next.activeVideoIsBlob ||
      current.activeVideoPaused !== next.activeVideoPaused ||
      current.activeVideoRecentlyPlayed !== next.activeVideoRecentlyPlayed ||
      current.identityConfidence !== next.identityConfidence;
    if (ownershipRelevant) {
      notifyOwnerListeners();
    }

    if (
      prevElement !== next.activeVideoElementIdentity ||
      prevSrc !== next.activeVideoCurrentSrc
    ) {
      logSocialCorrelation('active_video_changed', {
        platform: next.platform,
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        contextGeneration: next.contextGeneration,
        contentId: next.canonicalContentId ?? next.currentVisibleMediaIdentity,
        isBlob: next.activeVideoIsBlob,
        intersectionRatio: next.activeVideoIntersectionRatio,
      });
    }

    if (shouldBump) {
      logSocialCorrelation('context_changed', {
        platform: next.platform,
        tabId: next.tabId,
        navigationEpoch: next.navigationEpoch,
        contextGeneration: next.contextGeneration,
        contentId: next.canonicalContentId,
        reason: recycledOwnershipChange
          ? 'recycled_dom_element'
          : contentChanged
            ? 'content_id_changed'
            : 'active_video_ownership',
      });
    }

    return next;
  },

  isStaleGeneration(
    tabId: string,
    navigationEpoch: number,
    contextGeneration: number,
  ): boolean {
    const current = byTab.get(tabId)?.current;
    if (!current) {
      return true;
    }
    if (current.navigationEpoch !== navigationEpoch) {
      return true;
    }
    return contextGeneration !== current.contextGeneration;
  },

  clearTab(tabId: string): void {
    byTab.delete(tabId);
    notifyOwnerListeners();
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

/**
 * Detect meaningful media ownership change without treating every signed query refresh
 * as new content. Compare host+pathname only.
 */
function didMediaResourceOwnershipChange(
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

function resourcePathKey(url: string): string | null {
  if (url.toLowerCase().startsWith('blob:')) {
    return `blob:${url.slice(0, 48)}`;
  }
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}
