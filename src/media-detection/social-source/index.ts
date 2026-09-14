export type {
  SocialSourceTransport,
  SocialAudioState,
  SocialSourceVerificationState,
  SocialSourceFreshness,
  SocialSourceRejectionReason,
  SocialSourceVerificationEvidence,
  VerifiedSocialMediaVariant,
  VerifiedSocialMediaOffer,
  SocialSourceVerifyScope,
  FreshExecutableSocialSourceResult,
} from './types';

export {
  buildResourceIdentityKey,
  stableResourcePath,
  preserveExecutableUrl,
  sameResourceFamily,
  hashIdentity,
} from './resource-identity';

export {
  resolveSocialAudioState,
  isCombinedDownloadActionable,
  isVideoOnlyUnsupportedForCombinedUx,
} from './audio-evidence';

export {
  resolveQualityLabelFromEvidence,
  resolveCredibleSizeBytes,
  qualityFromDetectedMedia,
} from './quality-evidence';

export {
  verifySocialSourceCandidate,
  buildVerifiedSocialMediaOffer,
  offerToAnalysis,
  findFresherExecutableForVariant,
} from './social-source-reliability.service';

export { selectPreferredVariant, dedupeVariants } from './variant-policy';

export {
  getFreshExecutableSocialSource,
  clearSocialSourceRefreshAttempts,
  MAX_REFRESH_ATTEMPTS,
} from './social-source-provider';

export { ensurePhase1SocialSourceRefreshRegistered } from './register-phase1-source-refresh';

export {
  clearVerificationForTab,
  clearVerificationForContext,
  clearAllVerificationSessions,
  buildVerificationCacheKey,
} from './verification-session';

export { logSocialSource } from './social-source-diagnostics';
