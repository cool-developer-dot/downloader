export type {
  GeneralSourceTransport,
  GeneralAudioState,
  GeneralSourceRejectionReason,
  GeneralSourceVerificationEvidence,
  VerifiedGeneralMediaVariant,
  VerifiedGeneralMediaOffer,
  GeneralSourceVerifyScope,
} from './types';

export {
  buildVerifiedGeneralMediaOffer,
  verifyGeneralSourceCandidate,
  generalOfferToAnalysis,
} from './general-source-reliability.service';

export {
  resolveHlsAudioState,
  isHlsDrmOrUnsupportedEncryption,
  qualityLabelFromHlsVariant,
  resolveSizeFromHttpHeaders,
  hlsSizeBytesAlwaysOmitted,
  looksLikeHlsCandidate,
} from './hls-evidence';

export { logGeneralSource, hashIdentity } from './general-source-diagnostics';
