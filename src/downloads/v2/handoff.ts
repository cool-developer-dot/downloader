import type { EnqueueRequest, EnqueueResult, ProbeFailure } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadStatus } from '@/api/types';

import {
  buildV2EnqueueRequest,
  v2HandoffRejectionMessage,
  type V2HandoffInput,
  type V2HandoffRejection,
} from './enqueue-request';
import type { V2EnginePort } from './engine-port';
import { ensureGalleryPermission } from './gallery-permission';
import { ensureDownloadNotificationPermission } from './notification-permission';
import { projectV2Download, type V2DownloadEntry } from './projection';

/**
 * DUPLICATE outcomes: the user asked for a video they already have, so nothing new was started. Never a failure —
 * "Video is already downloading" / "Video already downloaded", not "Couldn't start this download".
 */
export type V2DuplicateOutcome = 'ALREADY_DOWNLOADING' | 'ALREADY_DOWNLOADED';

export type V2HandoffResult =
  | {
      ok: true;
      /** The new download, the existing one, or the library item holding the video (null: only its gallery copy). */
      downloadId: string | null;
      /** True when nothing new was started. */
      deduped: boolean;
      duplicate: V2DuplicateOutcome | null;
    }
  | {
      ok: false;
      reason: V2HandoffRejection | 'STALE_OFFER' | 'IN_FLIGHT' | 'ENGINE_UNAVAILABLE' | 'ENQUEUE_REJECTED';
      message: string;
    };

export type V2HandoffDeps = {
  engine: V2EnginePort | null;
  /** Mirrors the accepted record into the downloads store immediately (events follow). */
  applyEntries: (entries: V2DownloadEntry[]) => void;
  /** Current status of a v2 download the store mirrors, or null when unknown. */
  statusOf: (downloadId: string) => DownloadStatus | null;
  /** Re-checked right before the enqueue call: the offer's tab/content/generation must still be current. */
  isOfferCurrent: () => boolean;
};

/** Variant key → download id for this session: a second tap on the same verified variant reuses the download. */
const acceptedByVariant = new Map<string, string>();
const inFlight = new Set<string>();

/**
 * A download this session accepted that is still under way answers a repeat tap at once. A completed one is left to
 * the engine, which knows whether its library item and file still exist (a deleted video may be downloaded again).
 */
const REUSABLE: ReadonlySet<DownloadStatus> = new Set(['QUEUED', 'DOWNLOADING', 'PAUSED']);

const IN_FLIGHT_MESSAGE = 'Video is already downloading';

/** The engine's DUPLICATE answer as a hand-off result; an existing download is mirrored into Downloads. */
function duplicateResult(
  found: Exclude<EnqueueResult, { outcome: 'ENQUEUED' }>,
  deps: Pick<V2HandoffDeps, 'applyEntries'>,
): Extract<V2HandoffResult, { ok: true }> {
  if (found.outcome === 'ALREADY_DOWNLOADING') {
    deps.applyEntries([projectV2Download(found.record)]);
    return { ok: true, downloadId: found.record.id, deduped: true, duplicate: 'ALREADY_DOWNLOADING' };
  }
  return { ok: true, downloadId: found.libraryItemId, deduped: true, duplicate: 'ALREADY_DOWNLOADED' };
}

function isAlreadyDownloadedError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ERR_ALREADY_DOWNLOADED';
}

/**
 * Whether the user already has this exact variant — downloading, in the library, or as VidoraX's gallery copy —
 * asked before any network request (the pre-download gate, a stream classification). Null when the video is new, the
 * variant cannot be downloaded at all, or the native build cannot tell (the enqueue itself still refuses a duplicate).
 */
export async function findExistingDownload(
  input: V2HandoffInput,
  deps: Pick<V2HandoffDeps, 'engine' | 'applyEntries'>,
): Promise<Extract<V2HandoffResult, { ok: true }> | null> {
  const decision = buildV2EnqueueRequest(input);
  if (!decision.ok || !deps.engine?.findDuplicate) {
    return null;
  }
  try {
    const found = await deps.engine.findDuplicate(decision.request);
    return found && found.outcome !== 'ENQUEUED' ? duplicateResult(found, deps) : null;
  } catch {
    return null;
  }
}

function enqueueRejectionMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'ERR_POLICY_BLOCKED':
      return 'This source can’t be downloaded.';
    case 'ERR_INVALID_REQUEST':
      return 'This video is no longer available. Reload the page and try again.';
    default:
      return 'Couldn’t start this download.';
  }
}

/** The native classifier's verdict in the handoff's terms: PROTECTED / UNSUPPORTED / transient / expired. */
export function rejectionForProbeFailure(reason: ProbeFailure): V2HandoffRejection {
  switch (reason) {
    case 'DRM_PROTECTED':
      return 'PROTECTED';
    case 'LIVE_UNSUPPORTED':
      return 'LIVE_UNSUPPORTED';
    case 'NETWORK':
    case 'HTTP_ERROR':
      return 'SOURCE_UNREACHABLE';
    case 'HTTP_403':
    case 'HTTP_404':
      return 'SOURCE_EXPIRED';
    case 'VIDEO_TRACK_MISSING':
    case 'AUDIO_TRACK_MISSING':
      return reason;
    case 'TRACK_MISMATCH':
      return 'TRACK_MISMATCH';
    case 'UNSUPPORTED_FORMAT':
    case 'NOT_MEDIA':
    case 'POLICY_BLOCKED':
    default:
      return 'UNSUPPORTED_SOURCE';
  }
}

/**
 * A stream is only downloadable once the native classifier — the same one the engine uses — says so for the exact
 * variant that would be downloaded: for HLS its media playlist (VOD, unencrypted, single-track), for DASH the chosen
 * representation (one complete file, not protected, not live). It decides before anything is enqueued, so a
 * protected, live or unsupported stream never becomes a download row.
 */
async function classifyStream(
  engine: V2EnginePort,
  request: EnqueueRequest,
): Promise<{ ok: true } | { ok: false; reason: V2HandoffRejection | 'ENQUEUE_REJECTED'; message: string }> {
  try {
    // The chosen variant is the one classified: another quality of the same stream could differ.
    const { url, request: context, variant, audioUrl } = request;
    const result = await engine.probe({ url, kind: request.kind, request: context, variant, ...(audioUrl ? { audioUrl } : {}) });
    if (result.ok) {
      return { ok: true };
    }
    const reason = rejectionForProbeFailure(result.reason);
    return { ok: false, reason, message: v2HandoffRejectionMessage(reason) };
  } catch (error) {
    return { ok: false, reason: 'ENQUEUE_REJECTED', message: enqueueRejectionMessage(error) };
  }
}

/**
 * Hands exactly the chosen verified variant to the v2 DownloadEngine. There is no v1 fallback: a refused or failed
 * enqueue is reported as such. One enqueue per variant at a time; a repeat tap returns the accepted download.
 */
export async function handOffVerifiedVariant(
  input: V2HandoffInput & { variantKey: string },
  deps: V2HandoffDeps,
): Promise<V2HandoffResult> {
  const decision = buildV2EnqueueRequest(input);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason, message: v2HandoffRejectionMessage(decision.reason) };
  }
  const key = input.variantKey;
  const accepted = acceptedByVariant.get(key);
  if (accepted) {
    const status = deps.statusOf(accepted);
    if (status && REUSABLE.has(status)) {
      return { ok: true, downloadId: accepted, deduped: true, duplicate: 'ALREADY_DOWNLOADING' };
    }
    acceptedByVariant.delete(key);
  }
  if (inFlight.has(key)) {
    return { ok: false, reason: 'IN_FLIGHT', message: IN_FLIGHT_MESSAGE };
  }
  if (!deps.engine) {
    return { ok: false, reason: 'ENGINE_UNAVAILABLE', message: 'Downloads are unavailable in this build.' };
  }
  if (!deps.isOfferCurrent()) {
    return {
      ok: false,
      reason: 'STALE_OFFER',
      message: 'This video changed. Wait for “Video available” and try again.',
    };
  }
  inFlight.add(key);
  try {
    // The same video already downloading or saved answers before a stream is classified over the network.
    const existing = await findExistingDownload(input, deps);
    if (existing) {
      return existing;
    }
    if (decision.request.kind === 'hls' || decision.request.kind === 'dash' || decision.request.kind === 'split') {
      // Streams and split tracks: the native classifier decides for the exact variant / pair about to be enqueued.
      const verdict = await classifyStream(deps.engine, decision.request);
      if (!verdict.ok) {
        return verdict;
      }
      // Classifying took a round trip: the page may have moved on meanwhile.
      if (!deps.isOfferCurrent()) {
        return {
          ok: false,
          reason: 'STALE_OFFER',
          message: 'This video changed. Wait for “Video available” and try again.',
        };
      }
    }
    // The engine checks for the same video again and creates the download in one atomic step: two taps, two entry
    // points or a tap racing a restart still start one download.
    const result: EnqueueResult = deps.engine.enqueueUnique
      ? await deps.engine.enqueueUnique(decision.request)
      : { outcome: 'ENQUEUED', record: await deps.engine.enqueue(decision.request), libraryItemId: null };
    if (result.outcome !== 'ENQUEUED') {
      const duplicate = duplicateResult(result, deps);
      if (duplicate.duplicate === 'ALREADY_DOWNLOADING' && duplicate.downloadId) {
        acceptedByVariant.set(key, duplicate.downloadId);
      }
      return duplicate;
    }
    const record = result.record;
    acceptedByVariant.set(key, record.id);
    // Ask for the permissions from this gesture; a refusal never affects the download itself.
    void ensureDownloadNotificationPermission().then(() => ensureGalleryPermission());
    deps.applyEntries([projectV2Download(record)]);
    return { ok: true, downloadId: record.id, deduped: false, duplicate: null };
  } catch (error) {
    if (isAlreadyDownloadedError(error)) {
      return { ok: true, downloadId: null, deduped: true, duplicate: 'ALREADY_DOWNLOADED' };
    }
    return { ok: false, reason: 'ENQUEUE_REJECTED', message: enqueueRejectionMessage(error) };
  } finally {
    inFlight.delete(key);
  }
}

export function resetV2HandoffForTests(): void {
  acceptedByVariant.clear();
  inFlight.clear();
}
