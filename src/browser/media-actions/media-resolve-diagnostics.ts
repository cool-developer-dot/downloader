/**
 * Dev-only MEDIA_RESOLVE_TRACE — never logs Cookie, Authorization, or signed URLs.
 */

export type MediaResolveTraceEvent =
  | 'OWNER_READY'
  | 'IDENTITY_READY'
  | 'CANDIDATE_OBSERVED'
  | 'CANDIDATE_RANKED'
  | 'CANDIDATE_VERIFY_START'
  | 'CANDIDATE_VERIFY_REJECT'
  | 'CANDIDATE_VERIFY_SUCCESS'
  | 'OFFER_READY'
  | 'PROVEN_UNSUPPORTED'
  | 'TRANSIENT_UNRESOLVED';

export type MediaResolveTraceFields = {
  tabId?: string | null;
  platform?: string | null;
  generation?: number | null;
  identityKind?: string | null;
  event: MediaResolveTraceEvent;
  candidateType?: string | null;
  outcome?: string | null;
  rejectionReason?: string | null;
};

function hashSafe(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let hash = 0x811c9dc5;
  const sample = value.length > 64 ? `${value.slice(0, 32)}…${value.slice(-16)}` : value;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function logMediaResolveTrace(fields: MediaResolveTraceFields): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  try {
    // eslint-disable-next-line no-console
    console.log('[MEDIA_RESOLVE_TRACE]', {
      tabId: fields.tabId ?? null,
      platform: fields.platform ?? null,
      generation: fields.generation ?? null,
      identityKind: fields.identityKind ? hashSafe(fields.identityKind) : null,
      event: fields.event,
      candidateType: fields.candidateType ?? null,
      outcome: fields.outcome ?? null,
      rejectionReason: fields.rejectionReason ?? null,
    });
  } catch {
    // never throw from diagnostics
  }
}
