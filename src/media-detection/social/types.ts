/**
 * Phase 4A — Social media content ownership types.
 * Content identity ≠ resource (CDN) identity.
 */

export type SocialPlatform = 'instagram' | 'tiktok';

export type SocialContentType =
  | 'instagram_reel'
  | 'instagram_post'
  | 'instagram_feed_video'
  | 'tiktok_video'
  | 'tiktok_feed_video'
  | 'unknown_social_video';

export type SocialCorrelationConfidence =
  | 'STRONG'
  | 'MEDIUM'
  | 'WEAK'
  | 'REJECTED';

export type SocialRejectionReason =
  | 'WRONG_TAB'
  | 'STALE_NAVIGATION'
  | 'STALE_SOCIAL_CONTEXT'
  | 'IMAGE_RESOURCE'
  | 'POSTER_ONLY'
  | 'SEGMENT_RESOURCE'
  | 'BLOB_ONLY'
  | 'HIDDEN_VIDEO'
  | 'OFFSCREEN_PRELOAD'
  | 'NEIGHBOR_CONTENT'
  | 'ADVERTISEMENT'
  | 'UNSUPPORTED_RESOURCE'
  | 'WEAK_UNCORRELATED_MEDIA'
  | 'NON_VIDEO'
  | 'LOW_CORRELATION';

/**
 * Ephemeral social page context — never persisted.
 * Scoped by tabId + navigationEpoch + contextGeneration.
 */
export type SocialPageContext = {
  tabId: string;
  navigationEpoch: number;
  platform: SocialPlatform;
  pageUrl: string;
  canonicalPageUrl: string | null;
  contentType: SocialContentType;
  /** Stable post/reel/video id when known from route/DOM — never a CDN URL. */
  canonicalContentId: string | null;
  /** Bounded ephemeral id when stable id unavailable (feed without shortcode). */
  ephemeralContentId: string | null;
  activeVideoElementIdentity: string | null;
  currentVisibleMediaIdentity: string | null;
  /** Active player currentSrc — http(s) or blob: clue (blob never downloadable). */
  activeVideoCurrentSrc: string | null;
  activeVideoIsBlob: boolean;
  activeVideoIntersectionRatio: number | null;
  activeVideoPaused: boolean | null;
  activeVideoRecentlyPlayed: boolean;
  explicitAdMarker: boolean;
  contextGeneration: number;
  identityConfidence: SocialCorrelationConfidence;
  observedAt: number;
};

export type ActiveVideoEvidence = {
  pageUrl: string;
  elementIdentity: string;
  currentSrc: string | null;
  src: string | null;
  isBlob: boolean;
  paused: boolean | null;
  ended: boolean | null;
  readyState: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  muted: boolean | null;
  /** Coalesced — not frame-rate timeupdate. */
  currentTimeBucket: number | null;
  intersectionRatio: number | null;
  viewportCenterDistance: number | null;
  /** Rendered box in CSS px, when the page reported it. */
  displayWidth?: number | null;
  displayHeight?: number | null;
  isDisplayed: boolean;
  isVisibleStyle: boolean;
  recentlyPlayed: boolean;
  explicitAdMarker: boolean;
  /** Optional shortcode/video id scraped from nearest legitimate container. */
  associatedContentId: string | null;
  observedAt: number;
  /**
   * A MediaSource player's files, as the page named them from its own appends (its video and audio buffers): what a
   * blob player plays, the way `currentSrc` says it for a plain one. Absent until named.
   */
  playingFiles?: string[] | null;
  /** Present for general embedded-player evidence; ignored by Phase 4 social. */
  playerKind?: 'video' | 'iframe';
  frameClass?: 'top' | 'same-origin' | 'cross-origin';
};

export type CandidateOwnershipEvidence = {
  tabMatch: boolean;
  navigationMatch: boolean;
  socialContentMatch: boolean | null;
  activeVideoElementMatch: boolean | null;
  visibleVideoMatch: boolean | null;
  currentSrcMatch: boolean | null;
  recentObservation: boolean;
  currentPageMatch: boolean;
  preloadPenalty: boolean;
  hiddenElementPenalty: boolean;
  adPenalty: boolean;
  staleContextPenalty: boolean;
  segmentPenalty: boolean;
  imagePenalty: boolean;
  blobOnlyPenalty: boolean;
};

export type SocialCandidateCorrelation = {
  confidence: SocialCorrelationConfidence;
  rejectionReason: SocialRejectionReason | null;
  evidence: CandidateOwnershipEvidence;
  /** Internal ranking key — not exposed to UI. */
  rank: number;
};

export type CorrelatedCandidateGroup = {
  currentContentIdentity: string | null;
  platform: SocialPlatform | null;
  contextGeneration: number;
  navigationEpoch: number;
  tabId: string | null;
  activeCandidateIds: string[];
  rejected: ReadonlyArray<{
    candidateId: string;
    reason: SocialRejectionReason;
  }>;
  confidence: SocialCorrelationConfidence | null;
};

export type SocialContentIdentityResult = {
  platform: SocialPlatform;
  contentType: SocialContentType;
  canonicalContentId: string | null;
  canonicalPageUrl: string | null;
  identityConfidence: SocialCorrelationConfidence;
};
