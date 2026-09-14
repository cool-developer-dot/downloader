/**
 * Authoritative Resume strategy resolver.
 *
 * Native resumeData is an optimization — never the only path.
 * Missing resumeData + zero partial is RESTART_FROM_ZERO when the source
 * can be reconstructed, not RESUME_STATE_MISSING.
 */

import { hasResumableMultiRange } from './multi-range/resume';
import { parseAndroidResumeOffset } from './pause-state';
import type { LocalDownloadRecord } from './types';

function isHlsSourceUrl(sourceUrl: string): boolean {
  const lower = sourceUrl.trim().toLowerCase();
  return (
    lower.includes('.m3u8') ||
    lower.includes('m3u8') ||
    lower.includes('/playlist') ||
    lower.includes('application/vnd.apple.mpegurl')
  );
}

export type ResumeStrategy =
  | 'RANGE_RESUME'
  | 'NATIVE_CHECKPOINT_RESUME'
  | 'HLS_CHECKPOINT_RESUME'
  | 'MULTI_RANGE_RESUME'
  | 'RESTART_FROM_ZERO'
  | 'SESSION_CONTEXT_REQUIRED'
  | 'NOT_RESUMABLE';

export type ResumeStrategyInput = {
  transferKind: 'progressive' | 'hls' | 'multi_range' | 'unknown';
  remoteStatus: string | null | undefined;
  localState: string | null | undefined;
  partialSize: number;
  resumeDataAvailable: boolean;
  /** Opaque (non-numeric) native resume blob — iOS-style. */
  opaqueNativeResumeData: boolean;
  hlsCheckpointAvailable: boolean;
  multiRangeCheckpointAvailable: boolean;
  sourceUrlSafe: boolean;
  /** Session-bound download missing live ephemeral context. */
  sessionContextMissing: boolean;
  sourceRefreshRequired?: boolean;
};

export type ResumeStrategyResult = {
  strategy: ResumeStrategy;
  resumeOffset: number | null;
  resetProgress: boolean;
  sourceRefreshRequired: boolean;
  reason: string;
};

export function classifyPartialPathClass(uri: string | null | undefined): string {
  if (!uri) {
    return 'none';
  }
  const lower = uri.toLowerCase();
  if (lower.includes('.part')) {
    return 'canonical_part';
  }
  if (lower.includes('.rangepart')) {
    return 'range_temp';
  }
  if (lower.includes('/hls/') || lower.includes('hls-')) {
    return 'hls_workspace';
  }
  return 'other_managed';
}

export function isOpaqueNativeResumeData(
  resumeData: string | null | undefined,
): boolean {
  if (typeof resumeData !== 'string' || resumeData.length === 0) {
    return false;
  }
  return parseAndroidResumeOffset(resumeData) == null;
}

/**
 * Pure strategy selection — used by manager and verifiers.
 */
export function resolveResumeStrategy(
  input: ResumeStrategyInput,
): ResumeStrategyResult {
  const status = (input.remoteStatus ?? '').toUpperCase();
  const local = (input.localState ?? '').toLowerCase();

  if (status === 'CANCELLED' || status === 'COMPLETED' || local === 'complete') {
    return {
      strategy: 'NOT_RESUMABLE',
      resumeOffset: null,
      resetProgress: false,
      sourceRefreshRequired: false,
      reason: status || local || 'terminal',
    };
  }

  if (input.sessionContextMissing) {
    return {
      strategy: 'SESSION_CONTEXT_REQUIRED',
      resumeOffset: null,
      resetProgress: false,
      sourceRefreshRequired: false,
      reason: 'session_context_missing',
    };
  }

  if (!input.sourceUrlSafe) {
    return {
      strategy: 'NOT_RESUMABLE',
      resumeOffset: null,
      resetProgress: false,
      sourceRefreshRequired: false,
      reason: 'invalid_source',
    };
  }

  const refresh = Boolean(input.sourceRefreshRequired);

  if (input.transferKind === 'hls' || input.hlsCheckpointAvailable) {
    if (input.hlsCheckpointAvailable) {
      return {
        strategy: 'HLS_CHECKPOINT_RESUME',
        resumeOffset: null,
        resetProgress: false,
        sourceRefreshRequired: refresh,
        reason: 'hls_checkpoint',
      };
    }
    return {
      strategy: 'RESTART_FROM_ZERO',
      resumeOffset: null,
      resetProgress: true,
      sourceRefreshRequired: refresh,
      reason: 'hls_no_checkpoint',
    };
  }

  if (
    input.transferKind === 'multi_range' ||
    input.multiRangeCheckpointAvailable
  ) {
    if (input.multiRangeCheckpointAvailable && input.partialSize > 0) {
      return {
        strategy: 'MULTI_RANGE_RESUME',
        resumeOffset: input.partialSize,
        resetProgress: false,
        sourceRefreshRequired: refresh,
        reason: 'multi_range_checkpoint',
      };
    }
  }

  if (input.opaqueNativeResumeData && input.resumeDataAvailable) {
    return {
      strategy: 'NATIVE_CHECKPOINT_RESUME',
      resumeOffset: input.partialSize > 0 ? input.partialSize : null,
      resetProgress: false,
      sourceRefreshRequired: refresh,
      reason: 'opaque_native_resume',
    };
  }

  if (input.partialSize > 0) {
    return {
      strategy: 'RANGE_RESUME',
      resumeOffset: input.partialSize,
      resetProgress: false,
      sourceRefreshRequired: refresh,
      reason: 'durable_partial',
    };
  }

  // Zero durable bytes — safe honest restart when source can be reconstructed.
  return {
    strategy: 'RESTART_FROM_ZERO',
    resumeOffset: null,
    resetProgress: true,
    sourceRefreshRequired: refresh,
    reason: input.resumeDataAvailable
      ? 'resume_data_without_partial'
      : 'no_durable_partial',
  };
}

export function resolveResumeStrategyFromRecord(input: {
  record: LocalDownloadRecord;
  partialSize: number;
  sourceUrlSafe: boolean;
  sessionContextMissing: boolean;
  sourceRefreshRequired?: boolean;
}): ResumeStrategyResult {
  const { record } = input;
  const resumeData = record.pauseState?.resumeData ?? null;
  const isHls = isHlsSourceUrl(record.sourceUrl);
  const hlsCheckpoint =
    Boolean(record.hlsTransfer) &&
    (record.hlsTransfer?.completedSegments ?? 0) > 0;
  const multi = hasResumableMultiRange(record.multiRange);
  const transferKind: ResumeStrategyInput['transferKind'] = isHls
    ? 'hls'
    : multi
      ? 'multi_range'
      : 'progressive';

  return resolveResumeStrategy({
    transferKind,
    remoteStatus: record.remoteStatus,
    localState: record.localState,
    partialSize: Math.max(0, Math.trunc(input.partialSize)),
    resumeDataAvailable: Boolean(resumeData),
    opaqueNativeResumeData: isOpaqueNativeResumeData(resumeData),
    hlsCheckpointAvailable: hlsCheckpoint,
    multiRangeCheckpointAvailable: multi,
    sourceUrlSafe: input.sourceUrlSafe,
    sessionContextMissing: input.sessionContextMissing,
    sourceRefreshRequired: input.sourceRefreshRequired ?? false,
  });
}

/** Canonical on-disk partial size is the only progressive Range offset. */
export function canonicalResumeOffset(input: {
  partialSize: number;
  pauseResumeData?: string | null;
  bytesWrittenHint?: number;
}): number {
  const disk = Math.max(0, Math.trunc(input.partialSize));
  if (disk > 0) {
    return disk;
  }
  const android = parseAndroidResumeOffset(input.pauseResumeData);
  if (android != null && android > 0) {
    // Without disk bytes, numeric Android offset alone is unsafe for Range.
    return 0;
  }
  return 0;
}
