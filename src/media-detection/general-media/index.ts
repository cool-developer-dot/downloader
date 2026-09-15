export type {
  GeneralCorrelationConfidence,
  GeneralRejectionReason,
  GeneralPageMediaContext,
  GeneralOwnershipEvidence,
  GeneralCandidateCorrelation,
  CorrelatedGeneralMediaCandidateSet,
  ActiveVideoEvidence,
} from './types';

export {
  generalPageMediaContextStore,
  didGeneralMediaResourceOwnershipChange,
} from './general-page-context';

export {
  extractGeneralPageVideoId,
  buildGeneralCurrentMediaIdentity,
  generalPagePathKey,
  sanitizePlayerSrcPath,
} from './general-content-identity';

export {
  looksLikeGeneralPlayerIframe,
  looksLikePlayerIframeSrc,
  shouldAcceptIframeAsCurrentOwner,
  resolveIframeOwnerStrength,
  isNonVideoIframe,
} from './general-embedded-player';

export {
  correlateGeneralCandidate,
  selectCurrentGeneralMedia,
  selectCurrentMediaForActiveGeneralTab,
  isPosterOrImageResource,
  isThumbnailResource,
  isSegmentResource,
  isBlobOnlyResource,
  isUnsupportedScheme,
  isTinyPreviewContext,
} from './general-correlation.service';

export { logGeneralMedia, logGeneralOwnerTrace, logGeneralMediaTrace, logGeneralNetworkTrace, logGeneralCorrelationTrace, logGeneralVerifyTrace, logGeneralGenerationTrace, logGeneralDownloadTrace, hashSafeId } from './general-media-diagnostics';

export type { DynamicResourceFamily, GeneralCandidateFamily } from './general-network-resource';

export {
  classifyGeneralNetworkResource,
  classifyDynamicMediaResource,
  toAuthoritativeResourceFamily,
  nativeNetworkPrefilter,
  shouldObserveNativeNetworkRequest,
  resourceFingerprintFromUrl,
  isPlayerDocumentResource,
  isInitOrFragmentMediaPath,
  looksLikeHlsPlaylistPath,
  looksLikeDashManifestPath,
  looksLikeMediaFamilyPath,
} from './general-network-resource';

export {
  canonicalizeObservedMediaUrl,
  urlHasMediaQueryEvidence,
  urlHasPlaybackMediaEvidence,
  urlHasPlaybackPathEvidence,
} from './playback-media-evidence';

export {
  canonicalizeGeneralContentKey,
  classifyGeneralContentNavigation,
  isSameGeneralContentNavigation,
} from './general-content-navigation';
