/**
 * Safe __DEV__ diagnostics for Phase 4A social correlation.
 * Never logs cookies, Authorization, full signed CDN URLs, or credentials.
 */

type SocialDiagEvent =
  | 'context_created'
  | 'context_changed'
  | 'content_id_detected'
  | 'active_video_changed'
  | 'candidate_observed'
  | 'candidate_correlated'
  | 'candidate_rejected'
  | 'candidate_promoted'
  | 'candidate_demoted'
  | 'preload_suppressed'
  | 'stale_event_ignored'
  | 'tab_mismatch_rejected';

type SocialDiagFields = {
  platform?: string | null;
  tabId?: string | null;
  navigationEpoch?: number | null;
  contextGeneration?: number | null;
  contentId?: string | null;
  contentType?: string | null;
  candidateFingerprintHash?: string | null;
  reason?: string | null;
  confidence?: string | null;
  isBlob?: boolean;
  intersectionRatio?: number | null;
};

function hashSafeId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  // Short non-crypto fingerprint — never the full signed URL.
  let hash = 0x811c9dc5;
  const sample = value.length > 96 ? `${value.slice(0, 48)}…${value.slice(-24)}` : value;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function logSocialCorrelation(
  event: SocialDiagEvent,
  fields: SocialDiagFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  try {
    const payload: Record<string, unknown> = {
      event,
      platform: fields.platform ?? null,
      tabId: fields.tabId ?? null,
      navigationEpoch: fields.navigationEpoch ?? null,
      contextGeneration: fields.contextGeneration ?? null,
      contentIdHash: hashSafeId(fields.contentId),
      contentType: fields.contentType ?? null,
      candidateFingerprintHash:
        fields.candidateFingerprintHash ?? hashSafeId(fields.contentId),
      reason: fields.reason ?? null,
      confidence: fields.confidence ?? null,
    };
    if (fields.isBlob != null) {
      payload.isBlob = fields.isBlob;
    }
    if (fields.intersectionRatio != null) {
      payload.intersectionRatio = Number(fields.intersectionRatio.toFixed(2));
    }
    // eslint-disable-next-line no-console
    console.log('[SocialCorrelation]', payload);
  } catch {
    // never throw from diagnostics
  }
}

export { hashSafeId };
