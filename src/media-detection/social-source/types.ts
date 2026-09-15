/**
 * Phase 4B — Verified social media source / variant types.
 * Content identity (4A) ≠ resource identity ≠ executable request URL.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';
import type { SocialPlatform } from '../social/types';

export type SocialSourceTransport =
  | 'progressive'
  | 'hls'
  | 'adaptive_video_only'
  | 'audio_only'
  | 'unknown';

export type SocialAudioState =
  | 'INCLUDED'
  | 'VIDEO_ONLY'
  | 'AUDIO_ONLY'
  | 'UNKNOWN';

export type SocialSourceVerificationState =
  | 'UNVERIFIED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'STALE';

export type SocialSourceFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';

export type SocialSourceRejectionReason =
  | 'HTML_RESPONSE'
  | 'JSON_RESPONSE'
  | 'AUTH_RESPONSE'
  | 'NOT_MEDIA'
  | 'EXPIRED_SOURCE'
  | 'UNSUPPORTED_TRANSPORT'
  | 'VIDEO_ONLY_UNSUPPORTED'
  | 'MANIFEST_INVALID'
  | 'SESSION_CONTEXT_INVALID'
  | 'STALE_SOCIAL_CONTEXT'
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
  | 'CLOSED_TAB';

export type SocialSourceVerificationEvidence = {
  httpStatus: number | null;
  mimeType: string | null;
  contentLength: number | null;
  acceptRanges: boolean;
  redirectCount: number;
  signatureKind: string | null;
  usedRangeProbe: boolean;
};

export type VerifiedSocialMediaVariant = {
  /** Bounded manifest expansion retained with the cached primary. */
  alternatives?: VerifiedSocialMediaVariant[];
  variantId: string;
  /** Stable identity — host+path (+ quality/transport), never signed query alone. */
  resourceIdentity: string;
  /** Full current executable URL including signatures — never strip for download. */
  executableUrl: string;
  transport: SocialSourceTransport;
  container: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  qualityLabel: string | null;
  sizeBytes: number | null;
  audioState: SocialAudioState;
  downloadable: boolean;
  verificationEvidence: SocialSourceVerificationEvidence;
  requestContext: MediaRequestContext | null;
  verifiedAt: number;
  sourceGeneration: number;
};

export type VerifiedSocialMediaOffer = {
  contentIdentity: string;
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
  platform: SocialPlatform;
  variants: VerifiedSocialMediaVariant[];
  preferredVariantId: string | null;
  verifiedAt: number;
  verificationGeneration: number;
};

export type SocialSourceVerifyScope = {
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
  contentIdentity: string;
  /** Owning confidence from Phase 4A — REJECTED/WEAK may skip expensive work. */
  ownershipConfidence: 'STRONG' | 'MEDIUM' | 'WEAK' | 'REJECTED' | null;
};

export type FreshExecutableSocialSourceResult =
  | {
      outcome: 'FRESH';
      executableUrl: string;
      requestContext: MediaRequestContext;
      variantId: string;
      resourceIdentity: string;
      contentIdentity: string;
    }
  | { outcome: 'STALE_CONTEXT'; reason: SocialSourceRejectionReason }
  | { outcome: 'NO_SOURCE'; reason: SocialSourceRejectionReason }
  | { outcome: 'UNSUPPORTED'; reason: SocialSourceRejectionReason };
