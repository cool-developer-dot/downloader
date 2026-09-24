/**
 * Blob / MediaSource playback context (Phase 11B).
 *
 * A `blob:` URL is never downloadable and is never offered. What it *is* is proof that a player is
 * running whose real media arrives as separate HTTP(S) requests — so this holds the evidence needed to
 * decide, for the player that is actually on screen, whether those requests can be resolved into one
 * downloadable source, whether the playback is protected, or whether nothing downloadable exists.
 *
 * Scoped per tab and per navigation epoch + page generation, exactly like the other ownership stores:
 * a blob player in one tab must never explain a request in another, and a route change or a replaced
 * player must not inherit the previous player's evidence. Ephemeral and bounded — never persisted.
 */
import { isSameDocumentUrl } from '../utils';

export type MsePlaybackProtection = 'NONE' | 'PROTECTED';

export type MseSourceKind = 'mse' | 'blob';

/** What the observed HTTP(S) traffic for this player amounts to. */
export type MseSourceObservationKind = 'whole' | 'segment';

export type MsePlaybackState = {
  tabId: string;
  navigationEpoch: number;
  pageGeneration: number | null;
  pageUrl: string;
  /** The <video> the blob is attached to, when the sighting came from an element. */
  elementIdentity: string | null;
  sourceKind: MseSourceKind | null;
  protection: MsePlaybackProtection;
  /** Count of init/fragment/segment requests seen while this player was active. */
  segmentObservations: number;
  /** Count of whole-file HTTP(S) media candidates accepted while this player was active. */
  wholeSourceObservations: number;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** A player is "live" for this long after its last blob sighting. */
export const MSE_PLAYBACK_TTL_MS = 30_000;
/** Below this many segment sightings, "segments only" is not yet proven. */
export const MSE_SEGMENT_EVIDENCE_MIN = 3;
/** Give the page this long to produce a whole-file source before calling segments-only unresolvable. */
export const MSE_SEGMENT_SETTLE_MS = 2_500;
/** A blob player that produces no observable media at all for this long is unresolvable. */
export const MSE_SILENT_GIVE_UP_MS = 12_000;

const MAX_TAB_CONTEXTS = 8;

const byTab = new Map<string, MsePlaybackState>();
let activeTabId: string | null = null;

function evictIfNeeded(): void {
  if (byTab.size < MAX_TAB_CONTEXTS) {
    return;
  }
  for (const key of byTab.keys()) {
    if (key !== activeTabId) {
      byTab.delete(key);
      return;
    }
  }
  const oldest = byTab.keys().next().value;
  if (oldest !== undefined) {
    byTab.delete(oldest);
  }
}

export function setMseActiveTab(tabId: string | null): void {
  activeTabId = tabId;
}

/**
 * Record a blob / MediaSource sighting. A sighting for a different page, epoch, generation or player
 * element replaces the previous one outright — evidence is never carried across a content change.
 */
export function markMsePlayback(input: {
  tabId: string;
  navigationEpoch: number;
  pageGeneration?: number | null;
  pageUrl: string;
  elementIdentity?: string | null;
  sourceKind?: MseSourceKind | null;
  isProtected?: boolean;
}): MsePlaybackState {
  const now = Date.now();
  const previous = byTab.get(input.tabId);
  const generation = input.pageGeneration ?? null;
  const samePlayer =
    previous != null &&
    previous.navigationEpoch === input.navigationEpoch &&
    (previous.pageGeneration ?? null) === generation &&
    isSameDocumentUrl(previous.pageUrl, input.pageUrl) &&
    (input.elementIdentity == null ||
      previous.elementIdentity == null ||
      previous.elementIdentity === input.elementIdentity);

  if (!samePlayer) {
    evictIfNeeded();
  }

  const next: MsePlaybackState = {
    tabId: input.tabId,
    navigationEpoch: input.navigationEpoch,
    pageGeneration: generation,
    pageUrl: input.pageUrl,
    elementIdentity: input.elementIdentity ?? (samePlayer ? previous!.elementIdentity : null),
    sourceKind: input.sourceKind ?? (samePlayer ? previous!.sourceKind : null),
    // Protection is sticky for the life of one player: an encrypted stream does not become
    // downloadable because a later sighting happened to carry no key evidence.
    protection:
      input.isProtected === true || (samePlayer && previous!.protection === 'PROTECTED')
        ? 'PROTECTED'
        : 'NONE',
    segmentObservations: samePlayer ? previous!.segmentObservations : 0,
    wholeSourceObservations: samePlayer ? previous!.wholeSourceObservations : 0,
    firstSeenAt: samePlayer ? previous!.firstSeenAt : now,
    lastSeenAt: now,
  };
  byTab.set(input.tabId, next);
  return next;
}

/**
 * Attribute one observed media request to the blob player of that tab. Only requests that already
 * passed the engine's tab + epoch ownership checks reach here.
 */
export function recordMseSourceObservation(input: {
  tabId: string;
  navigationEpoch: number;
  kind: MseSourceObservationKind;
}): void {
  const state = byTab.get(input.tabId);
  if (!state || state.navigationEpoch !== input.navigationEpoch) {
    return;
  }
  if (input.kind === 'segment') {
    // Bounded: the count only has to cross a small threshold.
    state.segmentObservations = Math.min(state.segmentObservations + 1, 1_000);
  } else {
    state.wholeSourceObservations = Math.min(state.wholeSourceObservations + 1, 1_000);
  }
}

export function getMsePlaybackState(tabId: string | null): MsePlaybackState | null {
  if (!tabId) {
    return null;
  }
  const state = byTab.get(tabId);
  if (!state) {
    return null;
  }
  return Date.now() - state.lastSeenAt < MSE_PLAYBACK_TTL_MS ? state : null;
}

export function clearMsePlaybackForTab(tabId: string | null): void {
  if (tabId) {
    byTab.delete(tabId);
  }
}

export function clearMsePlayback(): void {
  byTab.clear();
}

/**
 * Legacy shape kept for the correlation callers: is a blob player live on this page right now.
 */
export function getMsePlaybackContext(currentPageUrl: string | null): {
  msePlaybackActive: boolean;
  msePlaybackAgeMs: number | null;
} {
  if (!currentPageUrl) {
    return { msePlaybackActive: false, msePlaybackAgeMs: null };
  }
  const state = getMsePlaybackState(activeTabId);
  if (!state || !isSameDocumentUrl(state.pageUrl, currentPageUrl)) {
    return { msePlaybackActive: false, msePlaybackAgeMs: null };
  }
  const ageMs = Date.now() - state.lastSeenAt;
  return { msePlaybackActive: ageMs >= 0 && ageMs < MSE_PLAYBACK_TTL_MS, msePlaybackAgeMs: ageMs };
}

export type MsePlaybackResolution =
  | { kind: 'NONE' }
  | { kind: 'PENDING'; reason: string }
  | { kind: 'RESOLVABLE' }
  | { kind: 'PROTECTED'; reason: 'PROTECTED_UNSUPPORTED' }
  | { kind: 'UNSUPPORTED'; reason: 'MSE_UNSUPPORTED'; detail: 'SEGMENTED_ONLY' | 'NO_SOURCE_OBSERVED' };

/**
 * Decide what a blob/MSE player amounts to, from evidence only.
 *
 * Protection wins over everything: an encrypted player is never offered, whatever else is on the page.
 * Otherwise a whole-file HTTP(S) source makes the player resolvable through the ordinary pipeline, and
 * only proven evidence — repeated segment-only traffic, or silence for long enough — is allowed to call
 * it unresolvable. Anything else stays PENDING, because "we have not seen it yet" must never be
 * reported to the user as "this cannot be downloaded".
 */
export function classifyMsePlayback(input: {
  state: MsePlaybackState | null;
  /** A whole-file HTTP(S) candidate currently correlated to this page. */
  hasWholeSourceCandidate: boolean;
  nowMs?: number;
}): MsePlaybackResolution {
  const state = input.state;
  if (!state) {
    return { kind: 'NONE' };
  }
  if (state.protection === 'PROTECTED') {
    return { kind: 'PROTECTED', reason: 'PROTECTED_UNSUPPORTED' };
  }
  if (input.hasWholeSourceCandidate || state.wholeSourceObservations > 0) {
    return { kind: 'RESOLVABLE' };
  }
  const now = input.nowMs ?? Date.now();
  const ageMs = now - state.firstSeenAt;
  if (
    state.segmentObservations >= MSE_SEGMENT_EVIDENCE_MIN &&
    ageMs >= MSE_SEGMENT_SETTLE_MS
  ) {
    return { kind: 'UNSUPPORTED', reason: 'MSE_UNSUPPORTED', detail: 'SEGMENTED_ONLY' };
  }
  if (state.segmentObservations === 0 && ageMs >= MSE_SILENT_GIVE_UP_MS) {
    return { kind: 'UNSUPPORTED', reason: 'MSE_UNSUPPORTED', detail: 'NO_SOURCE_OBSERVED' };
  }
  return {
    kind: 'PENDING',
    reason: state.segmentObservations > 0 ? 'MSE_SEGMENTS_OBSERVED' : 'MSE_AWAITING_SOURCE',
  };
}

/** Test/diagnostics — number of retained tab contexts. */
export function mseContextSize(): number {
  return byTab.size;
}
