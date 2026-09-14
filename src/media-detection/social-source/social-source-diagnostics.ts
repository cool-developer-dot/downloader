/**
 * Safe __DEV__ diagnostics for Phase 4B/4C — never logs signed URLs or secrets.
 */

import { hashIdentity } from './resource-identity';

type SocialSourceDiagEvent =
  | 'candidate_verify_started'
  | 'candidate_verify_joined'
  | 'candidate_verify_succeeded'
  | 'candidate_verify_rejected'
  | 'variant_created'
  | 'variant_deduped'
  | 'variant_replaced_with_fresher_source'
  | 'offer_created'
  | 'offer_invalidated'
  | 'freshness_check'
  | 'refresh_started'
  | 'refresh_succeeded'
  | 'refresh_failed'
  | 'stale_verification_ignored'
  | 'mid_transfer_refresh_requested'
  | 'mid_transfer_refresh_succeeded'
  | 'mid_transfer_refresh_unavailable'
  | 'stale_source_result_ignored'
  | 'source_selected'
  | 'source_rejected'
  | 'source_fragment_detected'
  | 'source_init_segment_detected'
  | 'source_progressive_verified'
  | 'source_adaptive_video_only'
  | 'source_container_unknown'
  | 'source_size_from_content_range'
  | 'source_probe_deduped';

type Fields = {
  platform?: string | null;
  tabId?: string | null;
  navigationEpoch?: number | null;
  contextGeneration?: number | null;
  contentIdentity?: string | null;
  variantId?: string | null;
  transport?: string | null;
  mime?: string | null;
  quality?: string | null;
  audioState?: string | null;
  verificationState?: string | null;
  reason?: string | null;
  httpStatus?: number | null;
  downloadId?: string | null;
  via?: string | null;
  containerKind?: string | null;
  sizeCategory?: string | null;
};

export function logSocialSource(
  event: SocialSourceDiagEvent,
  fields: Fields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  try {
    // eslint-disable-next-line no-console
    console.log('[SocialSource]', {
      event,
      platform: fields.platform ?? null,
      tabId: fields.tabId ?? null,
      navigationEpoch: fields.navigationEpoch ?? null,
      contextGeneration: fields.contextGeneration ?? null,
      contentIdentityHash: hashIdentity(fields.contentIdentity ?? ''),
      variantIdHash: fields.variantId ? hashIdentity(fields.variantId) : null,
      transport: fields.transport ?? null,
      mime: fields.mime ?? null,
      quality: fields.quality ?? null,
      audioState: fields.audioState ?? null,
      verificationState: fields.verificationState ?? null,
      reason: fields.reason ?? null,
      httpStatus: fields.httpStatus ?? null,
      downloadIdHash: fields.downloadId ? hashIdentity(fields.downloadId) : null,
      via: fields.via ?? null,
      containerKind: fields.containerKind ?? null,
      sizeCategory: fields.sizeCategory ?? null,
    });
  } catch {
    // never throw
  }
}
