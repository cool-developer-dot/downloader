export type {
  SocialPlatform,
  SocialContentType,
  SocialCorrelationConfidence,
  SocialRejectionReason,
  SocialPageContext,
  ActiveVideoEvidence,
  CandidateOwnershipEvidence,
  SocialCandidateCorrelation,
  CorrelatedCandidateGroup,
  SocialContentIdentityResult,
} from './types';

export {
  extractInstagramContentIdentity,
  isInstagramPageUrl,
  sanitizeInstagramShortcode,
} from './instagram-content-identity';

export {
  extractTikTokContentIdentity,
  extractTikTokVideoIdFromHref,
  isTikTokFeedSurfacePath,
  isTikTokPageUrl,
  isBlobMediaUrl,
  sanitizeTikTokVideoId,
} from './tiktok-content-identity';

export {
  classifyTikTokNetworkResource,
  isLikelyTikTokPreloadRelativeToOwner,
  isLikelyTikTokProgressiveMediaUrl,
  shouldClearDetectionsOnSocialBump,
} from './tiktok-media-resource';

export {
  observeCandidateInWindow,
  getWindowCandidates,
  mergeEligibleWindowCandidates,
  resetCandidateWindowsForTests,
} from '../observation/candidate-observation-window';

export {
  extractSocialContentIdentity,
  resolveSocialPlatform,
  resolveContentIdentityKey,
  isSameSocialContent,
} from './social-content-identity';

export { socialPageContextStore } from './social-page-context';

export {
  correlateSocialCandidate,
  selectCurrentSocialMedia,
  selectCurrentMediaForActiveSocialTab,
} from './social-correlation.service';

export { logSocialCorrelation, hashSafeId } from './social-correlation-diagnostics';
