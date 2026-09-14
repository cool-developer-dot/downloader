export { MediaDetectionPipeline, mediaDetectionPipeline } from './detection.service';
export type { PipelineResult } from './detection.service';
export { dedupeUpsert } from './deduplication.service';
export {
  enrichDashFromUrl,
  enrichHlsFromUrl,
  fetchHlsManifestText,
  fetchManifestResource,
  fetchManifestText,
  shouldEnrichAsDash,
} from './manifest.service';
export type { ManifestFetchOutcome } from './manifest.service';
export {
  clearMimeProbeCache,
  isVerifiedMediaMime,
  probeMediaMime,
} from './mime-probe.service';
export type { MimeProbeResult } from './mime-probe.service';
export { resolveRedirects } from './redirect.resolver';
export type { RedirectResolution } from './redirect.resolver';
export {
  classifyFalsePositive,
  isFalsePositive,
  isLikelyMediaSegment,
} from './false-positive.filter';
export { resolvePageUrl, isShareOrShortLink } from './page-url.resolver';
export type { PageUrlResolution } from './page-url.resolver';
export { verifyMediaCandidate } from './candidate-verifier.service';
export type { CandidateVerification } from './candidate-verifier.service';
export { logMediaDiagnostic, traceMediaPipeline } from './media-diagnostics.service';
export {
  hashHandoffIdentity,
  logAutomaticHandoff,
} from './automatic-handoff-diagnostics';
export type {
  AutomaticHandoffEvent,
  AutomaticHandoffPayload,
} from './automatic-handoff-diagnostics';
export {
  assessExpiringMediaUrl,
  isLikelyExpiredMediaUrl,
} from './expiring-url.service';
export {
  getDetectedMediaSnapshot,
  notifyBrowserDetectionSync,
  subscribeDetectionSync,
  toFutureDownloadContract,
} from './browser-sync.service';
export type { FutureDownloadMetadataContract } from './browser-sync.service';
export {
  scoreMediaCorrelation,
  pickBestCorrelatedMedia,
  filterCorrelatedCandidates,
  MIN_DISPLAY_SCORE,
} from './media-correlation.service';
export type {
  MediaCorrelationContext,
  MediaCorrelationResult,
} from './media-correlation.service';
