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
  | 'NON_VIDEO'
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
  explicitAdMarker: boolean;
  /** User play/click/touch strengthened this player recently. */
  userInteractionSignal: boolean;
  /** Top-level <video> vs visible embedded iframe player. */
  playerKind?: GeneralPlayerKind | null;
  frameClass?: GeneralFrameClass | null;
  iframeIdentity?: string | null;
  ownerStrength?: GeneralOwnerStrength | null;

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
  preloadPenalty: boolean;
  hiddenElementPenalty: boolean;
  tinyPreviewPenalty: boolean;
  adPenalty: boolean;
  staleContextPenalty: boolean;
  segmentPenalty: boolean;
  imagePenalty: boolean;
  posterPenalty: boolean;
  thumbnailPenalty: boolean;
  blobOnlyPenalty: boolean;
  unsupportedSchemePenalty: boolean;
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
