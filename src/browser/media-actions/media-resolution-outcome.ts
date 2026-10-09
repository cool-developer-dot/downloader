/**
 * Bounded current-video resolution outcomes.
 *
 * "This video can't be downloaded by VidoraX." is only for PROVEN_UNSUPPORTED
 * after a user-triggered bounded resolution attempt. First-null lookup,
 * in-flight verify, and stale results are TRANSIENT / STALE — never unavailable.
 */

export type MediaResolutionKind =
  | 'RESOLVED_SUPPORTED'
  | 'PROVEN_UNSUPPORTED'
  | 'TRANSIENT_UNRESOLVED'
  | 'STALE_CONTEXT'
  | 'SESSION_REQUIRED'
  | 'NETWORK_FAILURE';

export type MediaResolutionOutcome = {
  kind: MediaResolutionKind;
  reason: string | null;
};

const PROVEN_UNSUPPORTED_REASONS = new Set<string>([
  'DRM_UNSUPPORTED',
  'DASH_UNSUPPORTED',
  'BLOB_ONLY',
  'SEGMENT_RESOURCE',
  'INIT_SEGMENT',
  'MEDIA_FRAGMENT',
  'UNSUPPORTED_TRANSPORT',
  'VIDEO_ONLY_UNSUPPORTED',
  'MANIFEST_INVALID',
  'HTML_RESPONSE',
  'JSON_RESPONSE',
  'NOT_MEDIA',
  'PROTECTED_UNSUPPORTED',
  // A blob/MediaSource player proven to have no single downloadable source behind it.
  'MSE_UNSUPPORTED',
  // A MediaSource player fed by separate video and audio SourceBuffers: two sources that would need muxing.
  'SPLIT_AUDIO_VIDEO',
  'ENCRYPTED_HLS',
  'HLS_ENCRYPTED',
  'UNSUPPORTED_HLS_ENCRYPTION',
  'UNSUPPORTED_DRM',
  'LIVE_HLS_UNSUPPORTED',
  'LIVE_UNSUPPORTED',
  'UNSUPPORTED_FORMAT',
  // A split player's file proven (from its bytes) to have no picture / no sound.
  'VIDEO_TRACK_MISSING',
  'AUDIO_TRACK_MISSING',
]);

const SESSION_REASONS = new Set<string>([
  'AUTH_RESPONSE',
  'SESSION_CONTEXT_INVALID',
  'SESSION_EXPIRED',
  'AUTH_CONTEXT_UNAVAILABLE',
  'SESSION_CONTEXT_LOST',
]);

const STALE_REASONS = new Set<string>([
  // The link died between the offer and the tap; the page can still produce a new one.
  'SOURCE_EXPIRED',
  'STALE_SOCIAL_CONTEXT',
  'STALE_PAGE_GENERATION',
  'STALE_SOURCE_GENERATION',
  'STALE_NAVIGATION',
  'WRONG_TAB',
  'CLOSED_TAB',
  'EXPIRED_SOURCE',
  // Two files that are not one video's (or not the element's): the player moved on, look again.
  'TRACK_MISMATCH',
  'SPLIT_LENGTH_NOT_ELEMENT',
]);

/** The source may be fine; ownership evidence for the current content has not arrived yet. */
const OWNERSHIP_PENDING_REASONS = new Set<string>(['WEAK_OWNERSHIP']);

const NETWORK_REASONS = new Set<string>([
  'PROBE_FAILED',
  'NETWORK_ERROR',
  'NETWORK_TIMEOUT',
  'PROBE_TIMEOUT',
]);

export type ClassifyMediaResolutionInput = {
  rejectionReason?: string | null;
  hasCandidates?: boolean;
  verificationInFlight?: boolean;
  allBoundedCandidatesRejected?: boolean;
  resolvedSupported?: boolean;
  staleToken?: boolean;
};

/**
 * Map verifier / offer rejection into the product taxonomy.
 */
export function classifyMediaResolutionOutcome(
  input: ClassifyMediaResolutionInput,
): MediaResolutionOutcome {
  if (input.resolvedSupported) {
    return { kind: 'RESOLVED_SUPPORTED', reason: null };
  }
  if (input.staleToken) {
    return { kind: 'STALE_CONTEXT', reason: input.rejectionReason ?? 'STALE_CONTEXT' };
  }
  if (input.verificationInFlight) {
    return {
      kind: 'TRANSIENT_UNRESOLVED',
      reason: input.rejectionReason ?? 'VERIFYING',
    };
  }

  const reason = (input.rejectionReason ?? '').trim();

  if (reason && SESSION_REASONS.has(reason)) {
    return { kind: 'SESSION_REQUIRED', reason };
  }
  if (reason && STALE_REASONS.has(reason)) {
    return { kind: 'STALE_CONTEXT', reason };
  }
  if (reason && NETWORK_REASONS.has(reason)) {
    return { kind: 'NETWORK_FAILURE', reason };
  }
  if (reason && PROVEN_UNSUPPORTED_REASONS.has(reason)) {
    return { kind: 'PROVEN_UNSUPPORTED', reason };
  }
  if (reason && OWNERSHIP_PENDING_REASONS.has(reason)) {
    return { kind: 'TRANSIENT_UNRESOLVED', reason };
  }

  if (input.allBoundedCandidatesRejected) {
    return {
      kind: 'PROVEN_UNSUPPORTED',
      reason: reason || 'NO_SUPPORTED_SOURCE',
    };
  }

  if (!input.hasCandidates) {
    return {
      kind: 'TRANSIENT_UNRESOLVED',
      reason: reason || 'NO_FRESH_SOURCE',
    };
  }

  if (reason === 'NO_FRESH_SOURCE' || reason === 'WEAK_OWNERSHIP' || reason === 'PLATFORM_UNOBSERVABLE' || !reason) {
    return { kind: 'TRANSIENT_UNRESOLVED', reason: reason || 'NO_FRESH_SOURCE' };
  }

  return { kind: 'TRANSIENT_UNRESOLVED', reason: reason || 'UNRESOLVED' };
}

/** Unavailable copy is allowed only for definitive architecture failure. */
export function shouldShowUnavailableMessage(
  kind: MediaResolutionKind,
): boolean {
  return kind === 'PROVEN_UNSUPPORTED';
}

export const UNAVAILABLE_DOWNLOAD_MESSAGE =
  "This video can't be downloaded by VidoraX.";

export type DownloadResolutionToken = {
  tabId: string;
  navigationEpoch: number;
  generation: number;
  contentIdentity: string | null;
};

export function isDownloadResolutionTokenCurrent(
  captured: DownloadResolutionToken,
  live: DownloadResolutionToken,
): boolean {
  if (captured.tabId !== live.tabId) {
    return false;
  }
  if (captured.navigationEpoch !== live.navigationEpoch) {
    return false;
  }
  if (captured.generation !== live.generation) {
    return false;
  }
  if (
    captured.contentIdentity &&
    live.contentIdentity &&
    captured.contentIdentity !== live.contentIdentity
  ) {
    return false;
  }
  return true;
}

export function toastForResolutionOutcome(
  outcome: MediaResolutionOutcome,
  errorMessage?: string | null,
): string | null {
  if (shouldShowUnavailableMessage(outcome.kind)) {
    return UNAVAILABLE_DOWNLOAD_MESSAGE;
  }
  if (outcome.kind === 'SESSION_REQUIRED') {
    return errorMessage?.trim() || 'This video needs an active site session to download.';
  }
  if (outcome.kind === 'NETWORK_FAILURE') {
    return errorMessage?.trim() || 'Couldn’t reach the video source. Try again.';
  }
  // Transient / stale / supported-but-not-enqueued: no unavailable toast.
  return errorMessage?.trim() || null;
}

const TRANSIENT_FINDING_SOURCE_MESSAGE =
  'Still finding a downloadable source. Try again in a moment.';

const TRANSIENT_PREPARING_MESSAGE = 'Preparing download…';

/**
 * User-triggered Download tap must never silently no-op.
 * Auto-resolution continues to use toastForResolutionOutcome (no transient toast).
 */
export function toastForUserTriggeredDownloadOutcome(
  outcome: MediaResolutionOutcome,
  errorMessage?: string | null,
): string | null {
  const proven = toastForResolutionOutcome(outcome, errorMessage);
  if (proven) {
    return proven;
  }
  if (outcome.kind === 'TRANSIENT_UNRESOLVED') {
    if (outcome.reason === 'VERIFYING') {
      return TRANSIENT_PREPARING_MESSAGE;
    }
    return errorMessage?.trim() || TRANSIENT_FINDING_SOURCE_MESSAGE;
  }
  return errorMessage?.trim() || null;
}
