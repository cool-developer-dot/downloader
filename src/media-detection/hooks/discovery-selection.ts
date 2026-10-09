/**
 * Pure current-media selection behind useMediaDiscovery, and the ownership key that makes it reactive.
 *
 * Owner state lives in the general/social page context stores and changes without any new candidate
 * (MEDIUM → STRONG, the visible player switching, a preloaded video starting to play). Selection and
 * verification must be re-run on those changes, so they depend on {@link buildOwnershipKey}, which only
 * changes on material ownership transitions (strength, player, playing, visibility bucket) — never on currentTime
 * or intersection noise.
 */
import { generalPageMediaContextStore } from '../general-media/general-page-context';
import {
  getMsePlaybackState,
  msePlaybackVerdictKey,
  subscribeMsePlayback,
} from '../engine/mse-playback-context';
import { selectCurrentMediaForActiveGeneralTab } from '../general-media/general-correlation.service';
import { pickBestCorrelatedMedia } from '../services/media-correlation.service';
import { selectCurrentMediaForActiveSocialTab } from '../social/social-correlation.service';
import { resolveSocialPlatform } from '../social/social-content-identity';
import { socialPageContextStore } from '../social/social-page-context';
import { stableResourcePath } from '../social-source/resource-identity';
import type { DetectedMedia } from '../types';

function resourceKey(src: string | null | undefined): string {
  if (!src) {
    return '';
  }
  return src.toLowerCase().startsWith('blob:') ? 'blob' : (stableResourcePath(src) ?? '');
}

function playingKey(paused: boolean | null, recentlyPlayed: boolean): string {
  return paused === false || recentlyPlayed ? 'playing' : 'idle';
}

// Coarse buckets matching the ownership thresholds, so scroll jitter never re-runs selection.
function visibilityKey(ratio: number | null): string {
  if (ratio == null) {
    return 'unknown';
  }
  return ratio < 0.15 ? 'offscreen' : ratio >= 0.35 ? 'visible' : 'partial';
}

export function buildOwnershipKey(tabId: string | null): string {
  if (!tabId) {
    return '';
  }
  const general = generalPageMediaContextStore.get(tabId);
  const social = socialPageContextStore.get(tabId);
  // Blob/MediaSource ownership is owner state too: protection appearing, or a blob player being
  // replaced, changes what may be offered and must re-run selection and verification.
  const mse = getMsePlaybackState(tabId);
  const mseKey = mse
    ? [mse.navigationEpoch, mse.pageGeneration ?? '', mse.elementIdentity ?? '', mse.sourceKind ?? '', msePlaybackVerdictKey(mse)].join('|')
    : '';
  const generalKey = general
    ? [
        general.navigationEpoch,
        general.pageGeneration,
        general.currentMediaIdentity ?? '',
        general.ownerStrength ?? '',
        general.playerKind ?? '',
        resourceKey(general.activeVideoCurrentSrc),
        playingKey(general.activeVideoPaused, general.activeVideoRecentlyPlayed),
        visibilityKey(general.activeVideoIntersectionRatio),
      ].join('|')
    : '';
  const socialKey = social
    ? [
        social.navigationEpoch,
        social.contextGeneration,
        social.currentVisibleMediaIdentity ?? '',
        social.canonicalContentId ?? '',
        social.identityConfidence,
        resourceKey(social.activeVideoCurrentSrc),
        playingKey(social.activeVideoPaused, social.activeVideoRecentlyPlayed),
        visibilityKey(social.activeVideoIntersectionRatio),
      ].join('|')
    : '';
  return `${tabId}#g:${generalKey}#s:${socialKey}#m:${mseKey}`;
}

export function subscribeOwnership(listener: () => void): () => void {
  const unsubscribeGeneral = generalPageMediaContextStore.subscribe(listener);
  const unsubscribeSocial = socialPageContextStore.subscribe(listener);
  const unsubscribeMse = subscribeMsePlayback(listener);
  return () => {
    unsubscribeGeneral();
    unsubscribeSocial();
    unsubscribeMse();
  };
}

export function selectDiscoveryMedia(input: {
  candidates: DetectedMedia[];
  focusedMediaId: string | null;
  lastNavigation: string | null;
  activeTabId: string | null;
  navigationEpoch: number;
  /**
   * {@link buildOwnershipKey} for the active tab. Owner state itself is read from the context stores; the key
   * is part of the input so memoized callers re-select whenever ownership changes.
   */
  ownershipKey: string;
  msePlaybackActive: boolean;
  msePlaybackAgeMs: number | null;
}): DetectedMedia | null {
  const { candidates, activeTabId, lastNavigation } = input;
  if (candidates.length === 0) {
    return null;
  }
  if (input.focusedMediaId) {
    const focused = candidates.find((m) => m.id === input.focusedMediaId);
    if (focused) {
      return focused;
    }
  }

  const socialPlatform = lastNavigation ? resolveSocialPlatform(lastNavigation) : null;
  const correlation = {
    candidates,
    tabId: activeTabId,
    navigationEpoch: input.navigationEpoch,
    pageUrl: lastNavigation,
    msePlaybackActive: input.msePlaybackActive,
    msePlaybackAgeMs: input.msePlaybackAgeMs,
  };

  if (socialPlatform && activeTabId) {
    const social = selectCurrentMediaForActiveSocialTab(correlation);
    if (social.usedSocialCorrelation) {
      return social.media;
    }
  }

  // Ordinary websites: ownership evidence decides. When every candidate was rejected (offscreen
  // preload, another frame's media, stale generation, ad), nothing is current — never fall back to
  // "some HTTP media on the page", which would verify and offer media the player does not own.
  if (!socialPlatform && activeTabId) {
    const general = selectCurrentMediaForActiveGeneralTab(correlation);
    if (general.usedGeneralCorrelation) {
      return general.media;
    }
  }

  const mse = { pageUrl: lastNavigation, msePlaybackActive: input.msePlaybackActive, msePlaybackAgeMs: input.msePlaybackAgeMs };
  return (
    pickBestCorrelatedMedia(candidates, mse) ??
    candidates.find((m) => m.category === 'video') ??
    candidates.find((m) => m.category === 'stream') ??
    candidates[0] ??
    null
  );
}
