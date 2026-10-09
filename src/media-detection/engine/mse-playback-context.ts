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

/** How the player's SourceBuffers carry its tracks (the page's own `addSourceBuffer` MIME types). */
export type MseTrackLayout = 'muxed' | 'split' | 'video' | 'audio';

/** The files the page appended to this player's video and audio SourceBuffers (the latest of each). */
export type MseTrackFiles = { video: string | null; audio: string | null };

/** One whole media file requested while this player was active (the newest URL of that file). */
export type MseFileObservation = { key: string; url: string; lastSeenAt: number };

export type MsePlaybackState = {
  tabId: string;
  navigationEpoch: number;
  pageGeneration: number | null;
  pageUrl: string;
  /** The <video> the blob is attached to, when the sighting came from an element. */
  elementIdentity: string | null;
  sourceKind: MseSourceKind | null;
  protection: MsePlaybackProtection;
  /** Null until the page has created its SourceBuffers. */
  trackLayout: MseTrackLayout | null;
  /** When the layout was first seen as split (a player demuxing one stream also splits its buffers). */
  splitSeenAt?: number | null;
  /** Distinct media files (host + path, any byte range) requested while this player was active. Bounded. */
  fileSources?: string[];
  /** Full URLs of [fileSources] (newest request of each), for resolving a split player's two files. Bounded. */
  fileUrls?: MseFileObservation[];
  /** The exact files feeding this player's SourceBuffers, when the page's own reads name them. */
  trackFiles?: MseTrackFiles | null;
  /** The `blob:` URL the element plays: a new one is a new MediaSource, whose tracks start unknown. */
  blobUrl?: string | null;
  /** The element's duration (seconds), when the page reported it. */
  durationSec?: number | null;
  /** HLS/DASH manifests requested while this player was active: the engine classifies those itself. */
  manifestObservations?: number;
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
/** Requests kept per tab from before its page reported a player (a player requests its first files at once). */
const MAX_EARLY_OBSERVATIONS = 24;
const EARLY_OBSERVATION_TTL_MS = 30_000;

type SourceObservation = {
  kind: MseSourceObservationKind;
  resourceKey?: string | null;
  url?: string | null;
  isManifest?: boolean;
  /** When the request was seen (now, unless replayed). */
  at?: number;
};

const byTab = new Map<string, MsePlaybackState>();
/**
 * Media requests of a tab's current page (navigation epoch) made before that page reported a blob player: a player
 * built while the page loads fetches its files — often all of them, for a short video — before its first report
 * arrives. The player created next on that page starts from them; anything older or from another page is dropped.
 */
const earlyByTab = new Map<string, { navigationEpoch: number; observations: SourceObservation[] }>();
let activeTabId: string | null = null;
const listeners = new Set<() => void>();

/**
 * Called when what a player amounts to may have changed (protection, SourceBuffer layout, the number of files it is
 * fed from): selection and verification re-run on it, since nothing else on the page has to change with it.
 */
export function subscribeMsePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyMsePlayback(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A subscriber never breaks detection.
    }
  }
}

/** The part of a player's evidence that changes what may be offered. */
export function msePlaybackVerdictKey(state: MsePlaybackState | null): string {
  if (!state) {
    return '';
  }
  return [
    state.protection,
    state.trackLayout ?? '',
    Math.min((state.fileSources ?? []).length, 2),
    (state.manifestObservations ?? 0) > 0 ? 'm' : '',
    state.trackFiles?.video ?? '',
    state.trackFiles?.audio ?? '',
  ].join('|');
}

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
  trackLayout?: MseTrackLayout | null;
  trackFiles?: MseTrackFiles | null;
  durationSec?: number | null;
  blobUrl?: string | null;
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
    // Split tracks are sticky too: a player that needs two sources does not stop needing them.
    trackLayout:
      samePlayer && previous!.trackLayout === 'split'
        ? 'split'
        : (input.trackLayout ?? (samePlayer ? previous!.trackLayout : null)),
    splitSeenAt:
      samePlayer && previous!.splitSeenAt != null
        ? previous!.splitSeenAt
        : input.trackLayout === 'split'
          ? now
          : null,
    fileSources: samePlayer ? (previous!.fileSources ?? []) : [],
    fileUrls: samePlayer ? (previous!.fileUrls ?? []) : [],
    // The page's report names the current MediaSource's files; a new player or a new blob (the next item's
    // MediaSource on a recycled element) starts from nothing — never the previous item's tracks.
    trackFiles: mergeTrackFiles(
      samePlayer && !isNewBlob(previous!.blobUrl ?? null, input.blobUrl ?? null) ? (previous!.trackFiles ?? null) : null,
      input.trackFiles ?? null,
    ),
    blobUrl: input.blobUrl ?? (samePlayer ? (previous!.blobUrl ?? null) : null),
    durationSec: input.durationSec ?? (samePlayer ? (previous!.durationSec ?? null) : null),
    manifestObservations: samePlayer ? (previous!.manifestObservations ?? 0) : 0,
    segmentObservations: samePlayer ? previous!.segmentObservations : 0,
    wholeSourceObservations: samePlayer ? previous!.wholeSourceObservations : 0,
    firstSeenAt: samePlayer ? previous!.firstSeenAt : now,
    lastSeenAt: now,
  };
  if (!samePlayer) {
    replayEarlyObservations(next);
  }
  byTab.set(input.tabId, next);
  if (msePlaybackVerdictKey(previous ?? null) !== msePlaybackVerdictKey(next) || !samePlayer) {
    notifyMsePlayback();
  }
  return next;
}

/** A new player on a page starts from the requests that page made before any player was reported. */
function replayEarlyObservations(state: MsePlaybackState): void {
  const early = earlyByTab.get(state.tabId);
  earlyByTab.delete(state.tabId);
  if (!early || early.navigationEpoch !== state.navigationEpoch) {
    return;
  }
  const oldest = Date.now() - EARLY_OBSERVATION_TTL_MS;
  for (const observation of early.observations) {
    if ((observation.at ?? 0) >= oldest) {
      recordObservation(state, observation);
    }
  }
}

function rememberEarlyObservation(tabId: string, navigationEpoch: number, observation: SourceObservation): void {
  let early = earlyByTab.get(tabId);
  if (!early || early.navigationEpoch !== navigationEpoch) {
    early = { navigationEpoch, observations: [] };
    earlyByTab.set(tabId, early);
    if (earlyByTab.size > MAX_TAB_CONTEXTS) {
      const oldest = earlyByTab.keys().next().value;
      if (oldest !== undefined && oldest !== tabId) {
        earlyByTab.delete(oldest);
      }
    }
  }
  early.observations.push({ ...observation, at: Date.now() });
  if (early.observations.length > MAX_EARLY_OBSERVATIONS) {
    early.observations.shift();
  }
}

function isNewBlob(previous: string | null, next: string | null): boolean {
  return previous != null && next != null && previous !== next;
}

/** A report of the current MediaSource's files replaces the previous one outright; no report keeps it. */
function mergeTrackFiles(previous: MseTrackFiles | null, next: MseTrackFiles | null): MseTrackFiles | null {
  if (next && (next.video || next.audio)) {
    return { video: next.video, audio: next.audio };
  }
  return previous;
}

/**
 * Attribute one observed media request to the blob player of that tab. Only requests that already
 * passed the engine's tab + epoch ownership checks reach here.
 */
export function recordMseSourceObservation(input: {
  tabId: string;
  navigationEpoch: number;
  kind: MseSourceObservationKind;
  /** Host + path of the requested file (byte ranges and signatures are the same file). */
  resourceKey?: string | null;
  /** The full request URL (its newest form is kept for that file). */
  url?: string | null;
  isManifest?: boolean;
}): void {
  const state = byTab.get(input.tabId);
  if (!state || state.navigationEpoch !== input.navigationEpoch) {
    // No player reported for this page yet: kept for the one it reports next.
    rememberEarlyObservation(input.tabId, input.navigationEpoch, input);
    return;
  }
  const before = msePlaybackVerdictKey(state);
  recordObservation(state, input);
  if (msePlaybackVerdictKey(state) !== before) {
    notifyMsePlayback();
  }
}

function recordObservation(state: MsePlaybackState, input: SourceObservation): void {
  if (input.isManifest) {
    state.manifestObservations = Math.min((state.manifestObservations ?? 0) + 1, 1_000);
  } else if (input.kind === 'whole' && input.resourceKey) {
    const files = state.fileSources ?? [];
    if (!files.includes(input.resourceKey) && files.length < 8) {
      state.fileSources = [...files, input.resourceKey];
    }
    if (input.url && files.length <= 8) {
      const urls = (state.fileUrls ?? []).filter((f) => f.key !== input.resourceKey);
      urls.push({ key: input.resourceKey, url: input.url, lastSeenAt: input.at ?? Date.now() });
      state.fileUrls = urls.slice(-8);
    }
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
    earlyByTab.delete(tabId);
  }
}

export function clearMsePlayback(): void {
  byTab.clear();
  earlyByTab.clear();
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
  | { kind: 'PENDING'; reason: string; retryInMs?: number }
  | { kind: 'RESOLVABLE' }
  /**
   * Separate video and audio SourceBuffers fed from separate files: the two files are downloaded and merged.
   * `buffers`: the page named the exact file behind each buffer. `network`: only the files requested while this
   * player was active are known (newest first) — the pair must be proven by their bytes and lengths.
   */
  | {
      kind: 'SPLIT_TRACKS';
      source: 'buffers' | 'network';
      videoUrl: string | null;
      audioUrl: string | null;
      candidateUrls: string[];
      durationMs: number | null;
    }
  | { kind: 'PROTECTED'; reason: 'PROTECTED_UNSUPPORTED' }
  | {
      kind: 'UNSUPPORTED';
      reason: 'MSE_UNSUPPORTED';
      detail: 'SEGMENTED_ONLY' | 'NO_SOURCE_OBSERVED' | 'SPLIT_AUDIO_VIDEO';
    };

/** A file's object path (any host, query or byte range): the same file served by another CDN edge is the same file. */
function filePathOf(url: string | null | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname.length >= 12 ? parsed.pathname : `${parsed.host}${parsed.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Whether `mediaUrl` is one of the files feeding this split player (a video-only or audio-only half). A whole file the
 * player never read — the page's own declared file of the same video, offered before its player switched to split
 * buffers — is not. Unknown (no state, no URL) counts as a half.
 */
export function isSplitPlayerFile(
  state: Pick<MsePlaybackState, 'fileUrls' | 'trackFiles'> | null,
  mediaUrl: string | null | undefined,
): boolean {
  const offered = filePathOf(mediaUrl);
  if (!state || !offered) {
    return true;
  }
  const files = [
    ...(state.fileUrls ?? []).map((file) => file.url),
    state.trackFiles?.video ?? null,
    state.trackFiles?.audio ?? null,
  ];
  return files.some((url) => filePathOf(url) === offered);
}

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
  /** An HLS/DASH manifest is among the page's candidates (whenever it was requested). */
  hasManifestCandidate?: boolean;
  nowMs?: number;
}): MsePlaybackResolution {
  const state = input.state;
  if (!state) {
    return { kind: 'NONE' };
  }
  if (state.protection === 'PROTECTED') {
    return { kind: 'PROTECTED', reason: 'PROTECTED_UNSUPPORTED' };
  }
  // Separate video and audio SourceBuffers fed from separate files (no manifest): what plays is a video file and an
  // audio file, downloaded and merged. A whole file fetched for this player is one of those halves, so it is never
  // offered on its own. Split buffers alone prove nothing — a player that demuxes one muxed stream (hls.js with
  // MPEG-TS) splits its buffers too — and a manifest is classified by the engine itself.
  if (state.trackLayout === 'split' && (state.manifestObservations ?? 0) === 0 && !input.hasManifestCandidate) {
    const durationMs = state.durationSec != null ? Math.round(state.durationSec * 1000) : null;
    const files = state.trackFiles;
    if (files?.video && files.audio) {
      return { kind: 'SPLIT_TRACKS', source: 'buffers', videoUrl: files.video, audioUrl: files.audio, candidateUrls: [], durationMs };
    }
    const splitAgeMs = (input.nowMs ?? Date.now()) - (state.splitSeenAt ?? state.firstSeenAt);
    if ((state.fileSources ?? []).length >= 2 && splitAgeMs >= MSE_SEGMENT_SETTLE_MS) {
      const candidateUrls = [...(state.fileUrls ?? [])].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((f) => f.url);
      if (candidateUrls.length >= 2) {
        return { kind: 'SPLIT_TRACKS', source: 'network', videoUrl: null, audioUrl: null, candidateUrls, durationMs };
      }
    }
    if (splitAgeMs < MSE_SEGMENT_SETTLE_MS) {
      // The second file is usually requested within moments of the first: do not offer one half before that.
      return { kind: 'PENDING', reason: 'MSE_SPLIT_TRACKS_PENDING', retryInMs: MSE_SEGMENT_SETTLE_MS - splitAgeMs };
    }
    if ((state.fileSources ?? []).length >= 2) {
      // Two halves seen but not yet their URLs: never offer one half as the whole video.
      return { kind: 'PENDING', reason: 'MSE_SPLIT_TRACKS_PENDING', retryInMs: 1_000 };
    }
    if (splitAgeMs < MSE_SILENT_GIVE_UP_MS) {
      // One file so far: it is probably one half, its partner not requested yet. Only a player that keeps playing
      // from that single file for a long while is demuxing one muxed file itself.
      return { kind: 'PENDING', reason: 'MSE_SPLIT_TRACKS_PENDING', retryInMs: 1_000 };
    }
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
