/**
 * Phase 5A — General website media ownership types.
 * Answers: which media belongs to the current page/player the user means?
 * Does not decide downloadability (Phase 5B).
 */

import type { ActiveVideoEvidence } from '../social/types';
import type {
  GeneralFrameClass,
  GeneralOwnerStrength,
  GeneralPlayerKind,
} from './general-embedded-player';

export type GeneralCorrelationConfidence =
  | 'STRONG'
  | 'MEDIUM'
  | 'WEAK'
  | 'REJECTED';

export type GeneralRejectionReason =
  | 'WRONG_TAB'
  | 'STALE_NAVIGATION'
  | 'STALE_PAGE_GENERATION'
  | 'IMAGE_RESOURCE'
  | 'POSTER_ONLY'
  | 'THUMBNAIL_RESOURCE'
  | 'SEGMENT_RESOURCE'
  | 'BLOB_ONLY'
  | 'UNSUPPORTED_SCHEME'
  | 'HIDDEN_VIDEO'
  | 'OFFSCREEN_PRELOAD'
  | 'TINY_PREVIEW'
  | 'ADVERTISEMENT'
  | 'WEAK_UNCORRELATED_MEDIA'
  /** Requested by a frame that is neither the current player frame nor the page. */
  | 'FOREIGN_FRAME_MEDIA'
  /** Requested by the page itself while the current player is a separate (iframe) document. */
  | 'OUTSIDE_CURRENT_PLAYER'
  /** No initiator evidence (no Referer) to tie a network request to the current player. */
  | 'UNPROVEN_FRAME_OWNERSHIP'
  | 'NON_VIDEO'
  /** The URL names another item than the one the current player shows (the previous or next feed item). */
  | 'OTHER_CONTENT'
  | 'LOW_CORRELATION';

/**
 * Ephemeral general page media context — never persisted.
 * Scoped by tabId + navigationEpoch + pageGeneration.
 */
export type GeneralPageMediaContext = {
  tabId: string;
  navigationEpoch: number;
  /** Lower-level SPA/player generation inside a navigation epoch. */
  pageGeneration: number;
  pageUrl: string;

  activeMediaElementIdentity: string | null;
  /** Host+pathname of active player resource (never signed query). */
  activeMediaResourceIdentity: string | null;
  currentMediaIdentity: string | null;

  activeVideoCurrentSrc: string | null;
  activeVideoIsBlob: boolean;
  activeVideoIntersectionRatio: number | null;
  activeVideoPaused: boolean | null;
  activeVideoRecentlyPlayed: boolean;
  activeVideoMuted: boolean | null;
  activeVideoWidth: number | null;
  activeVideoHeight: number | null;
  /** Rendered box of the active player in CSS px, when known. */
  activeVideoDisplayWidth?: number | null;
  activeVideoDisplayHeight?: number | null;
  /**
   * A recycled blob/MSE player just switched to its next source. Its player library requested that source (the
   * manifest or file behind the new blob) moments before attaching it, so requests observed in this previous
   * generation since `carryObservedSince` still belong to what is current.
   */
  carryFromGeneration?: number | null;
  carryObservedSince?: number | null;
  explicitAdMarker: boolean;
  /** User play/click/touch strengthened this player recently. */
  userInteractionSignal: boolean;
  /** Top-level <video> vs visible embedded iframe player. */
  playerKind?: GeneralPlayerKind | null;
  frameClass?: GeneralFrameClass | null;
  iframeIdentity?: string | null;
  ownerStrength?: GeneralOwnerStrength | null;
  /**
   * The resource the user asked the browser for on this page (a WebView download: a pasted `.mpd`, an attachment
   * link). While set it is the page's current media, until the player moves to another element or source.
   */
  requestedMediaIdentity?: string | null;
  /**
   * The video id the page URL names describes the media the page opened with — not every video the page plays
   * afterwards under the same URL (a reel/feed viewer that scrolls without changing its address). The id is bound to
   * the first player resource shown under it; a player showing another resource gets its own element/resource
   * identity, and the URL's id again once that resource is back on screen.
   */
  pageIdResource?: string | null;
  /** The resource that was playing when the URL switched to its current id: it cannot be what the new id names. */
  pageIdExcludedResource?: string | null;
  /**
   * The feed item the active player shows (a content id from the player's own item, or from the item it is laid
   * over). The same player moving to another item is a new video even when its element and source never change.
   */
  activeAssociatedContentId?: string | null;
  /**
   * The player that owns the current video was on screen and reported itself off screen since (hidden, removed from
   * layout, zero size, or — an iframe player, or a video that is not playing — out of view): nothing of that video
   * is on screen any more. A feed hides its one shared player while it moves it to the next item and
   * loads that item into it; until the player shows again the page's current video is unknown.
   */
  activeOwnerHidden?: boolean;
  /**
   * The current player has been on screen since it became the player: only such a player going off screen hides its
   * video's offer (the video below the fold of a page just opened keeps it).
   */
  activeOwnerSeenOnScreen?: boolean;
  /** The active blob player's files as the page named them (see ActiveVideoEvidence.playingFiles). */
  activeVideoPlayingFiles?: string[] | null;

  observedAt: number;
};

export type GeneralOwnershipEvidence = {
  tabMatch: boolean;
  navigationMatch: boolean;
  pageGenerationMatch: boolean;
  activeVideoElementMatch: boolean | null;
  visibleVideoMatch: boolean | null;
  currentSrcMatch: boolean | null;
  recentObservation: boolean;
  currentPageMatch: boolean;
  userInteractionMatch: boolean;
  /** The user asked the browser for this very resource on the current page (a WebView download). */
  userRequestedMatch: boolean;
  preloadPenalty: boolean;
  hiddenElementPenalty: boolean;
  /** Idle (paused, never played) element whose visibility has not been reported yet. */
  visibilityUnknownPenalty: boolean;
  /** The active element currently has no source (a recycled player between items): nothing is current yet. */
  emptyPlayerPenalty: boolean;
  tinyPreviewPenalty: boolean;
  adPenalty: boolean;
  staleContextPenalty: boolean;
  segmentPenalty: boolean;
  imagePenalty: boolean;
  posterPenalty: boolean;
  thumbnailPenalty: boolean;
  blobOnlyPenalty: boolean;
  unsupportedSchemePenalty: boolean;
  /** The URL names the item the current player shows. */
  contentIdMatch: boolean;
  /** The URL names another item than the one the current player shows. */
  contentIdMismatch: boolean;
};

export type GeneralCandidateCorrelation = {
  confidence: GeneralCorrelationConfidence;
  rejectionReason: GeneralRejectionReason | null;
  evidence: GeneralOwnershipEvidence;
  /** Internal ranking key — not exposed to UI. */
  rank: number;
};

export type CorrelatedGeneralMediaCandidateSet = {
  currentMediaIdentity: string | null;
  pageGeneration: number;
  navigationEpoch: number;
  tabId: string | null;
  pageUrl: string | null;
  activeCandidateIds: string[];
  rejected: ReadonlyArray<{
    candidateId: string;
    reason: GeneralRejectionReason;
  }>;
  confidence: GeneralCorrelationConfidence | null;
};

export type { ActiveVideoEvidence };
export type {
  GeneralFrameClass,
  GeneralOwnerStrength,
  GeneralPlayerKind,
} from './general-embedded-player';
