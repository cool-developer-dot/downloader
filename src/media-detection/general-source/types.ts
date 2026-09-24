/**
 * Phase 5B — Verified general-web media source / variant types.
 * Media identity (5A) ≠ variant/resource identity ≠ executable request URL.
 *
 * Reuses Phase 4B conceptual model; does not reopen ownership ranking.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';
import type {
  SocialAudioState,
  SocialSourceTransport,
  SocialSourceVerificationEvidence,
} from '../social-source/types';

/** Same transport vocabulary as Phase 4B — shared product semantics. */
export type GeneralSourceTransport = SocialSourceTransport;

export type GeneralAudioState = SocialAudioState;

export type GeneralSourceRejectionReason =
  | 'HTML_RESPONSE'
  | 'JSON_RESPONSE'
  | 'AUTH_RESPONSE'
  | 'AUTH_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'PROTECTED_UNSUPPORTED'
  | 'NOT_MEDIA'
  | 'EXPIRED_SOURCE'
  | 'UNSUPPORTED_TRANSPORT'
  | 'VIDEO_ONLY_UNSUPPORTED'
  | 'MANIFEST_INVALID'
  | 'STALE_PAGE_GENERATION'
  | 'STALE_SOURCE_GENERATION'
  | 'NO_FRESH_SOURCE'
  | 'BLOB_ONLY'
  | 'SEGMENT_RESOURCE'
  | 'INIT_SEGMENT'
  | 'MEDIA_FRAGMENT'
  | 'WEAK_OWNERSHIP'
  | 'PROBE_FAILED'
  | 'DRM_UNSUPPORTED'
  | 'WRONG_TAB'
  | 'CLOSED_TAB'
  | 'DASH_UNSUPPORTED'
  | 'LIVE_HLS_UNSUPPORTED'
  /** A live stream (DASH `type="dynamic"`): there is no whole video to save. */
  | 'LIVE_UNSUPPORTED'
  /** The engine's classifier refuses the file itself: audio only, or a container it cannot finish. */
  | 'UNSUPPORTED_FORMAT';

export type GeneralSourceVerificationEvidence = SocialSourceVerificationEvidence;

export type VerifiedGeneralMediaVariant = {
  variantId: string;
  /** Stable identity — host+path (+ quality/transport), never signed query alone. */
  resourceIdentity: string;
  /** Full current executable URL including signatures — never strip for download. */
  executableUrl: string;
  transport: GeneralSourceTransport;
  container: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  qualityLabel: string | null;
  sizeBytes: number | null;
  audioState: GeneralAudioState;
  downloadable: boolean;
  verificationEvidence: GeneralSourceVerificationEvidence;
  requestContext: MediaRequestContext | null;
  verifiedAt: number;
  sourceGeneration: number;
  /** DASH only: the representation the native classifier found downloadable (its `ProbeVariant.id`). */
  representationId?: string | null;
};

export type VerifiedGeneralMediaOffer = {
  mediaIdentity: string;
  tabId: string;
  navigationEpoch: number;
  pageGeneration: number;
  variants: VerifiedGeneralMediaVariant[];
  preferredVariantId: string | null;
  verifiedAt: number;
};

export type GeneralSourceVerifyScope = {
  tabId: string;
  navigationEpoch: number;
  pageGeneration: number;
  mediaIdentity: string;
  /** Owning confidence from Phase 5A — REJECTED must not be resurrected by ranking. */
  ownershipConfidence: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null;
};
