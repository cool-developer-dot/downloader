import type { EnqueueRequest, ProbeFailure } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { DownloadStatus } from '@/api/types';

import {
  buildV2EnqueueRequest,
  v2HandoffRejectionMessage,
  type V2HandoffInput,
  type V2HandoffRejection,
} from './enqueue-request';
import type { V2EnginePort } from './engine-port';
import { markDownloadStarted } from './autoplay';
import { ensureDownloadNotificationPermission } from './notification-permission';
import { projectV2Download, type V2DownloadEntry } from './projection';

export type V2HandoffResult =
  | { ok: true; downloadId: string; deduped: boolean }
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

const REUSABLE: ReadonlySet<DownloadStatus> = new Set(['QUEUED', 'DOWNLOADING', 'PAUSED', 'COMPLETED']);

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
    const { url, request: context, variant } = request;
    const result = await engine.probe({ url, kind: request.kind, request: context, variant });
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
      return { ok: true, downloadId: accepted, deduped: true };
    }
    acceptedByVariant.delete(key);
  }
  if (inFlight.has(key)) {
    return { ok: false, reason: 'IN_FLIGHT', message: 'Download is already starting.' };
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
    if (decision.request.kind === 'hls' || decision.request.kind === 'dash') {
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
    const record = await deps.engine.enqueue(decision.request);
    acceptedByVariant.set(key, record.id);
    // This is the download that may play by itself when it finishes.
    markDownloadStarted(record.id);
    // Ask for the notification permission from this gesture; a refusal never affects the download itself.
    void ensureDownloadNotificationPermission();
    deps.applyEntries([projectV2Download(record)]);
    return { ok: true, downloadId: record.id, deduped: false };
  } catch (error) {
    return { ok: false, reason: 'ENQUEUE_REJECTED', message: enqueueRejectionMessage(error) };
  } finally {
    inFlight.delete(key);
  }
}

export function resetV2HandoffForTests(): void {
  acceptedByVariant.clear();
  inFlight.clear();
}
