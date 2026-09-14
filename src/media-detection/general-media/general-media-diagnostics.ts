/**
 * Safe __DEV__ diagnostics for Phase 5A general media ownership.
 * Never logs cookies, Authorization, full signed CDN URLs, or credentials.
 */

type GeneralDiagEvent =
  | 'page_context_created'
  | 'media_element_seen'
  | 'media_element_active'
  | 'candidate_correlated'
  | 'candidate_rejected'
  | 'preload_suppressed'
  | 'poster_rejected'
  | 'segment_rejected'
  | 'blob_clue'
  | 'generation_changed'
  | 'stale_candidate_ignored'
  | 'tab_context_cleared'
  | 'candidate_promoted'
  | 'candidate_demoted'
  | 'tiny_preview_suppressed'
  | 'ad_penalized'
  | 'GENERAL_PLAYER_DISCOVERED'
  | 'GENERAL_VIDEO_DISCOVERED'
  | 'GENERAL_IFRAME_PLAYER_DISCOVERED'
  | 'GENERAL_OWNER_ACQUIRED'
  | 'GENERAL_OWNER_CHANGED'
  | 'GENERAL_OWNER_REJECTED'
  | 'GENERAL_CANDIDATE_OBSERVED'
  | 'GENERAL_MANIFEST_OBSERVED'
  | 'GENERAL_CANDIDATE_CORRELATED'
  | 'GENERAL_VERIFY_STARTED'
  | 'GENERAL_VERIFY_SUCCEEDED'
  | 'GENERAL_VERIFY_REJECTED'
  | 'GENERAL_CTA_BOUND'
  | 'GENERAL_NETWORK_TRACE'
  | 'GENERAL_CORRELATION_TRACE'
  | 'GENERAL_VERIFY_TRACE'
  | 'GENERAL_GENERATION_TRACE'
  | 'GENERAL_DOWNLOAD_TRACE';

type GeneralDiagFields = {
  tabId?: string | null;
  navigationEpoch?: number | null;
  pageGeneration?: number | null;
  pageUrlHash?: string | null;
  mediaIdentityHash?: string | null;
  candidateFingerprintHash?: string | null;
  reason?: string | null;
  confidence?: string | null;
  isBlob?: boolean;
  intersectionRatio?: number | null;
  ownerStrength?: string | null;
  playerKind?: string | null;
  identityKind?: string | null;
  frameClass?: string | null;
  candidateType?: string | null;
  sourceClass?: string | null;
  verificationState?: string | null;
  rejectionReason?: string | null;
  mainPageHostClass?: string | null;
  requestHostClass?: string | null;
  requestPathShape?: string | null;
  initiatorClass?: string | null;
  hasRange?: boolean;
  mimeHintClass?: string | null;
  candidateFamily?: string | null;
  acceptedIntoIngest?: boolean;
  observationSource?: string | null;
  acceptClass?: string | null;
  pathClass?: string | null;
  method?: string | null;
  resourceTypeHint?: string | null;
  modulePresent?: boolean | null;
  oldPathClass?: string | null;
  newPathClass?: string | null;
  oldIdentity?: string | null;
  newIdentity?: string | null;
  didVideoIdentityChange?: boolean;
  stage?: string | null;
};

export function hashSafeId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let hash = 0x811c9dc5;
  const sample = value.length > 96 ? `${value.slice(0, 48)}…${value.slice(-24)}` : value;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const HIGH_FREQ_EVENTS = new Set<string>([
  'GENERAL_NETWORK_TRACE',
  'media_element_seen',
  'media_element_active',
]);
const lastDiagEmit = new Map<string, number>();
const HIGH_FREQ_MIN_MS = 400;

function allowDiag(event: string, stage?: string | null): boolean {
  if (!HIGH_FREQ_EVENTS.has(event)) {
    return true;
  }
  const key = `${event}:${stage ?? ''}`;
  const now = Date.now();
  const prev = lastDiagEmit.get(key) ?? 0;
  if (now - prev < HIGH_FREQ_MIN_MS) {
    return false;
  }
  lastDiagEmit.set(key, now);
  if (lastDiagEmit.size > 64) {
    const first = lastDiagEmit.keys().next().value;
    if (first) {
      lastDiagEmit.delete(first);
    }
  }
  return true;
}

export function logGeneralMedia(
  event: GeneralDiagEvent,
  fields: GeneralDiagFields = {},
): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }
  if (!allowDiag(event, fields.stage)) {
    return;
  }
  try {
    const payload: Record<string, unknown> = {
      event,
      tabId: fields.tabId ?? null,
      navigationEpoch: fields.navigationEpoch ?? null,
      pageGeneration: fields.pageGeneration ?? null,
      pageUrlHash: fields.pageUrlHash ?? null,
      mediaIdentityHash: fields.mediaIdentityHash ?? null,
      candidateFingerprintHash: fields.candidateFingerprintHash ?? null,
      reason: fields.reason ?? null,
      confidence: fields.confidence ?? null,
    };
    if (fields.isBlob != null) {
      payload.isBlob = fields.isBlob;
    }
    if (fields.intersectionRatio != null) {
      payload.intersectionRatio = Number(fields.intersectionRatio.toFixed(2));
    }
    if (fields.ownerStrength) {
      payload.ownerStrength = fields.ownerStrength;
    }
    if (fields.playerKind) {
      payload.playerKind = fields.playerKind;
    }
    if (fields.identityKind) {
      payload.identityKind = fields.identityKind;
    }
    if (fields.frameClass) {
      payload.frameClass = fields.frameClass;
    }
    if (fields.candidateType) {
      payload.candidateType = fields.candidateType;
    }
    if (fields.sourceClass) {
      payload.sourceClass = fields.sourceClass;
    }
    if (fields.verificationState) {
      payload.verificationState = fields.verificationState;
    }
    if (fields.rejectionReason) {
      payload.rejectionReason = fields.rejectionReason;
    }
    if (fields.stage) {
      payload.stage = fields.stage;
    }
    if (fields.mainPageHostClass) {
      payload.mainPageHostClass = fields.mainPageHostClass;
    }
    if (fields.requestHostClass) {
      payload.requestHostClass = fields.requestHostClass;
    }
    if (fields.requestPathShape) {
      payload.requestPathShape = fields.requestPathShape;
    }
    if (fields.initiatorClass) {
      payload.initiatorClass = fields.initiatorClass;
    }
    if (fields.hasRange != null) {
      payload.hasRange = fields.hasRange;
    }
    if (fields.mimeHintClass) {
      payload.mimeHintClass = fields.mimeHintClass;
    }
    if (fields.candidateFamily) {
      payload.candidateFamily = fields.candidateFamily;
    }
    if (fields.acceptedIntoIngest != null) {
      payload.acceptedIntoIngest = fields.acceptedIntoIngest;
    }
    if (fields.observationSource) {
      payload.observationSource = fields.observationSource;
    }
    if (fields.acceptClass) {
      payload.acceptClass = fields.acceptClass;
    }
    if (fields.pathClass) {
      payload.pathClass = fields.pathClass;
    }
    if (fields.method) {
      payload.method = fields.method;
    }
    if (fields.resourceTypeHint) {
      payload.resourceTypeHint = fields.resourceTypeHint;
    }
    if (fields.modulePresent != null) {
      payload.modulePresent = fields.modulePresent;
    }
    if (fields.oldPathClass) {
      payload.oldPathClass = fields.oldPathClass;
    }
    if (fields.newPathClass) {
      payload.newPathClass = fields.newPathClass;
    }
    if (fields.oldIdentity) {
      payload.oldIdentity = fields.oldIdentity;
    }
    if (fields.newIdentity) {
      payload.newIdentity = fields.newIdentity;
    }
    if (fields.didVideoIdentityChange != null) {
      payload.didVideoIdentityChange = fields.didVideoIdentityChange;
    }
    // eslint-disable-next-line no-console
    console.log('[GeneralMedia]', payload);
  } catch {
    // never throw from diagnostics
  }
}

export function logGeneralOwnerTrace(
  event:
    | 'GENERAL_PLAYER_DISCOVERED'
    | 'GENERAL_VIDEO_DISCOVERED'
    | 'GENERAL_IFRAME_PLAYER_DISCOVERED'
    | 'GENERAL_OWNER_ACQUIRED'
    | 'GENERAL_OWNER_CHANGED'
    | 'GENERAL_OWNER_REJECTED'
    | 'GENERAL_CTA_BOUND',
  fields: {
    tabId?: string | null;
    pageGeneration?: number | null;
    mediaGeneration?: number | null;
    ownerStrength?: string | null;
    playerKind?: string | null;
    identityKind?: string | null;
    frameClass?: string | null;
    reason?: string | null;
  } = {},
): void {
  logGeneralMedia(event, {
    tabId: fields.tabId,
    pageGeneration: fields.pageGeneration ?? fields.mediaGeneration,
    ownerStrength: fields.ownerStrength,
    playerKind: fields.playerKind,
    identityKind: fields.identityKind,
    frameClass: fields.frameClass,
    reason: fields.reason,
  });
}

export function logGeneralMediaTrace(
  event:
    | 'GENERAL_CANDIDATE_OBSERVED'
    | 'GENERAL_MANIFEST_OBSERVED'
    | 'GENERAL_CANDIDATE_CORRELATED'
    | 'GENERAL_VERIFY_STARTED'
    | 'GENERAL_VERIFY_SUCCEEDED'
    | 'GENERAL_VERIFY_REJECTED',
  fields: {
    tabId?: string | null;
    candidateType?: string | null;
    sourceClass?: string | null;
    frameClass?: string | null;
    verificationState?: string | null;
    rejectionReason?: string | null;
  } = {},
): void {
  logGeneralMedia(event, {
    tabId: fields.tabId,
    candidateType: fields.candidateType,
    sourceClass: fields.sourceClass,
    frameClass: fields.frameClass,
    verificationState: fields.verificationState,
    rejectionReason: fields.rejectionReason,
  });
}

export function logGeneralNetworkTrace(
  stage:
    | 'RESOURCE_SEEN'
    | 'RESOURCE_OBSERVED'
    | 'RESOURCE_CLASSIFIED'
    | 'RESOURCE_PREFILTER_CLASSIFIED'
    | 'RESOURCE_REJECTED'
    | 'NATIVE_EMITTED'
    | 'JS_RECEIVED'
    | 'OBSERVER_STARTED'
    | 'CANDIDATE_INGESTED',
  fields: GeneralDiagFields = {},
): void {
  logGeneralMedia('GENERAL_NETWORK_TRACE', { ...fields, stage });
}

export function logGeneralCorrelationTrace(
  stage:
    | 'CANDIDATE_RANKED'
    | 'CANDIDATE_CORRELATED'
    | 'CANDIDATE_REJECTED'
    | 'ACTIVE_CANDIDATE_SET',
  fields: GeneralDiagFields = {},
): void {
  logGeneralMedia('GENERAL_CORRELATION_TRACE', { ...fields, stage });
}

export function logGeneralVerifyTrace(
  stage:
    | 'VERIFY_STARTED'
    | 'VERIFY_REJECTED'
    | 'VERIFY_SUCCEEDED'
    | 'OFFER_READY',
  fields: GeneralDiagFields = {},
): void {
  logGeneralMedia('GENERAL_VERIFY_TRACE', { ...fields, stage });
}

export function logGeneralGenerationTrace(
  stage:
    | 'SPA_CHANGE_OBSERVED'
    | 'SAME_CONTENT_IGNORED'
    | 'CONTENT_CHANGED'
    | 'GENERATION_BUMPED',
  fields: GeneralDiagFields = {},
): void {
  logGeneralMedia('GENERAL_GENERATION_TRACE', { ...fields, stage });
}

export function logGeneralDownloadTrace(
  stage:
    | 'TAP'
    | 'RESOLUTION_JOINED'
    | 'TRANSIENT_UNRESOLVED'
    | 'PROVEN_UNSUPPORTED'
    | 'STALE_CONTEXT'
    | 'NETWORK_FAILURE'
    | 'ENQUEUE_ACCEPTED',
  fields: GeneralDiagFields = {},
): void {
  logGeneralMedia('GENERAL_DOWNLOAD_TRACE', { ...fields, stage });
}
