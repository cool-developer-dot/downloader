/**
 * H20 File integrity, the JavaScript side: Checksum Verify (#409), Repair Partial File (#412) and Play While
 * Downloading (#411). The native module does the work (VidoraMedia.types.ts); this file holds the pure rules the
 * screens use and a typed view of those optional native calls (missing on older builds — every helper then answers
 * "not available" instead of failing).
 */

import type {
  ChecksumState,
  PlayableCheck,
  PlayableSource,
  RepairOutcome,
  VidoraMediaModuleApi,
} from '@modules/vidorax-media/src/VidoraMedia.types';

import type { TranslationKey } from '@/localization';

import { getV2Engine } from './engine-port';

export type FileIntegrityPort = Partial<
  Pick<
    VidoraMediaModuleApi,
    | 'getChecksum'
    | 'computeChecksum'
    | 'getChecksumProgress'
    | 'cancelChecksum'
    | 'getRepairInfo'
    | 'repairDownload'
    | 'checkPlayable'
    | 'getPlayableSource'
    | 'releasePlayableSource'
  >
>;

/** The engine's file-integrity calls, or null without the native module. */
export function fileIntegrity(): FileIntegrityPort | null {
  return getV2Engine() as unknown as FileIntegrityPort | null;
}

const SHA256 = /^[0-9a-f]{64}$/;

export function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256.test(value);
}

/** Pure: the digest in groups of eight, for reading (copy and share use the plain hex). */
export function groupSha256(hex: string): string {
  return isSha256(hex) ? (hex.match(/.{8}/g) ?? []).join(' ') : hex;
}

/** Pure: whole percent of a running computation; null when unknown. */
export function checksumPercent(progress: { bytesDone: number; totalBytes: number } | null | undefined): number | null {
  if (!progress || !(progress.totalBytes > 0) || !Number.isFinite(progress.bytesDone)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.floor((progress.bytesDone / progress.totalBytes) * 100)));
}

/** The stored digest, or null (none yet, an older build, or an error reading it). */
export async function storedChecksum(port: FileIntegrityPort | null, id: string): Promise<ChecksumState | null> {
  if (!port?.getChecksum) {
    return null;
  }
  try {
    const state = await port.getChecksum(id);
    return { sha256: isSha256(state?.sha256) ? state.sha256 : null, computing: state?.computing === true };
  } catch {
    return null;
  }
}

/** The message shown after Repair, per outcome. */
export const REPAIR_MESSAGE_KEYS: Record<RepairOutcome, TranslationKey> = {
  resumed: 'fileIntegrity.repairResumed',
  restarted_changed: 'fileIntegrity.repairRestartedChanged',
  restarted_corrupt: 'fileIntegrity.repairRestartedCorrupt',
  restarted_no_resume: 'fileIntegrity.repairRestartedNoResume',
  segment_refetched: 'fileIntegrity.repairSegmentRefetched',
  unreachable: 'fileIntegrity.repairUnreachable',
  nothing: 'fileIntegrity.repairNothing',
};

export function repairMessageKey(outcome: unknown): TranslationKey {
  return (typeof outcome === 'string' && outcome in REPAIR_MESSAGE_KEYS
    ? REPAIR_MESSAGE_KEYS[outcome as RepairOutcome]
    : 'fileIntegrity.repairFailed');
}

/** Pure: Repair is offered for a failed v2 download that has partial bytes on disk. */
export function canOfferRepair(status: string | null | undefined, repairInfo: { partialBytes: number } | null): boolean {
  return status === 'FAILED' && repairInfo != null && repairInfo.partialBytes > 0;
}

/**
 * Pure: whether to ask native code about Play While Downloading at all. A download being processed (merged, checked)
 * shows `DOWNLOADING` with the `VERIFYING` worker state: never. Native code decides the rest (only a progressive MP4
 * with its index first and enough bytes; never HLS, DASH or split tracks).
 */
export function mayPlayWhileDownloading(status: string | null | undefined, workerState: string | null | undefined): boolean {
  if (status !== 'DOWNLOADING' && status !== 'PAUSED' && status !== 'QUEUED') {
    return false;
  }
  return (workerState ?? '').toUpperCase() !== 'VERIFYING';
}

/** Pure: a native answer that may be trusted as playable (an older or odd answer is not). */
export function isPlayable(answer: PlayableCheck | PlayableSource | null | undefined): boolean {
  return answer?.playable === true && Number.isFinite(answer.totalBytes) && answer.totalBytes > 0;
}

/**
 * Pure: whether to ask again later. Only "not enough bytes yet" (or an answer that did not come) changes by itself as
 * the download goes on; a playable answer stays, and a refusal for good (a stream, an index at the end, protected…)
 * is not asked about again.
 */
export function shouldAskAgain(answer: PlayableCheck | null | undefined): boolean {
  if (!answer) {
    return true;
  }
  return answer.playable !== true && answer.reason === 'not_enough_bytes';
}

/** Pure: the opened source's URI, only when it is VidoraX's own growing-file provider. */
export function playableUri(source: PlayableSource | null | undefined): string | null {
  if (!source || source.playable !== true || typeof source.uri !== 'string') {
    return null;
  }
  return /^content:\/\/[^/]+\.vidorax\.growing\/v\/[0-9a-f]{32}$/.test(source.uri) ? source.uri : null;
}
