/**
 * Safe __DEV__ diagnostics for Phase 5B general source reliability.
 * Never logs cookies, Authorization, full signed URLs, or credentials.
 */

import { hashIdentity } from '../social-source/resource-identity';

type GeneralSourceDiagEvent =
  | 'offer_created'
  | 'candidate_verify_started'
  | 'candidate_verify_joined'
  | 'candidate_verify_succeeded'
  | 'candidate_verify_rejected'
  | 'variant_created'
  | 'variant_deduped'
  | 'hls_master_expanded'
  | 'hls_media_verified'
  | 'hls_drm_rejected'
  | 'hls_live_rejected'
  | 'hls_auth_required'
  | 'hls_manifest_invalid'
  | 'dash_classified'
  | 'dash_rejected'
  | 'native_refused'
  | 'claimed_by_manifest'
  | 'stale_verification_ignored'
  | 'ownership_rejected_not_resurrected'
  | 'source_progressive_verified'
  | 'source_webm_verified'
  | 'source_init_segment_detected'
  | 'source_fragment_detected'
  | 'source_size_from_content_range'
  | 'preferred_variant_selected';

type GeneralSourceDiagFields = {
  tabId?: string | null;
  navigationEpoch?: number | null;
  pageGeneration?: number | null;
  mediaIdentityHash?: string | null;
  variantId?: string | null;
  resourceIdentityHash?: string | null;
  transport?: string | null;
  container?: string | null;
  quality?: string | null;
  audioState?: string | null;
  reason?: string | null;
  mime?: string | null;
  httpStatus?: number | null;
  sizeCategory?: string | null;
  statusCategory?: string | null;
};

export function logGeneralSource(
  event: GeneralSourceDiagEvent,
  fields: GeneralSourceDiagFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  try {
    // eslint-disable-next-line no-console
    console.log('[GeneralSource]', {
      event,
      tabId: fields.tabId ?? null,
      navigationEpoch: fields.navigationEpoch ?? null,
      pageGeneration: fields.pageGeneration ?? null,
      mediaIdentityHash: fields.mediaIdentityHash ?? null,
      variantId: fields.variantId ?? null,
      resourceIdentityHash: fields.resourceIdentityHash ?? null,
      transport: fields.transport ?? null,
      container: fields.container ?? null,
      quality: fields.quality ?? null,
      audioState: fields.audioState ?? null,
      reason: fields.reason ?? null,
      mime: fields.mime ?? null,
      httpStatus: fields.httpStatus ?? null,
      sizeCategory: fields.sizeCategory ?? null,
      statusCategory: fields.statusCategory ?? null,
    });
  } catch {
    // never throw from diagnostics
  }
}

export { hashIdentity };
