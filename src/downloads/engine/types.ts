import type { DownloadPauseState } from 'expo-file-system';
import type { DownloadStatus } from '@/api';

export type LocalTransferState =
  | 'not_started'
  | 'transferring'
  | 'finalizing'
  | 'paused'
  | 'complete'
  | 'missing'
  | 'corrupt'
  | 'deleted'
  | 'failed';

export type DownloadEngineErrorCode =
  | 'NETWORK_ERROR'
  | 'NETWORK_TIMEOUT'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'FILE_SYSTEM_ERROR'
  | 'FILE_WRITE_FAILED'
  | 'FILE_APPEND_FAILED'
  | 'FILE_FINALIZE_FAILED'
  | 'INSUFFICIENT_STORAGE'
  | 'INVALID_DESTINATION'
  | 'PERMISSION_DENIED'
  | 'PARTIAL_FILE_CORRUPT'
  | 'FINAL_FILE_INVALID'
  | 'CANCELLED'
  | 'INVALID_RESOURCE'
  | 'TRANSFER_INTERRUPTED'
  | 'PAUSE_FAILED'
  | 'RESUME_FAILED'
  | 'RESUME_UNSUPPORTED'
  | 'RESUME_STATE_MISSING'
  | 'RESUME_STATE_CONFLICT'
  | 'QUEUE_ADMISSION_FAILED'
  | 'PARTIAL_FILE_MISSING'
  | 'RANGE_REJECTED'
  | 'INVALID_RANGE_RESPONSE'
  | 'SOURCE_CHANGED'
  | 'RETRY_EXHAUSTED'
  | 'MERGE_FAILED'
  | 'PART_SIZE_MISMATCH'
  | 'FINAL_SIZE_MISMATCH'
  | 'CANCEL_FAILED'
  | 'WORKER_NOT_FOUND'
  | 'AUTH_ERROR'
  | 'SESSION_CONTEXT_LOST'
  | 'SESSION_CHANGED'
  | 'SESSION_EXPIRED'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'HLS_UNSUPPORTED'
  | 'HLS_ENCRYPTED'
  | 'UNSUPPORTED_DRM'
  | 'UNSUPPORTED_HLS_ENCRYPTION'
  | 'LIVE_HLS_UNSUPPORTED'
  | 'UNSUPPORTED_HLS_BYTERANGE'
  | 'INVALID_HLS_PLAYLIST'
  | 'FIRST_BYTE_TIMEOUT'
  | 'TRANSFER_STALLED'
  | 'PROBE_TIMEOUT'
  | 'PROBE_TOO_LARGE'
  | 'HLS_MANIFEST_TIMEOUT'
  | 'HLS_SEGMENT_TIMEOUT'
  | 'UNKNOWN_ERROR';

/** Why a download entered PAUSED — distinguishes user intent from network holds. */
export type DownloadPauseReason =
  | 'USER'
  | 'NETWORK_POLICY'
  | 'SYSTEM_RECOVERY';

/** Compact HLS job state — no per-segment history. */
export type HlsTransferState = {
  totalSegments: number;
  completedSegments: number;
  currentSegment: number | null;
  downloadedBytes: number;
  failedSegment: number | null;
  retryCount: number;
  lastFailureReason: string | null;
};

/** Optional HTTP validators retained for Range / If-Range resume. */
export type RangeValidators = {
  etag?: string | null;
  lastModified?: string | null;
  /** Full object Content-Length / Content-Range total when known. */
  contentLength?: number | null;
};

export type TransferProgressSnapshot = {
  downloadId: string;
  bytesWritten: number;
  totalBytes: number | null;
  progress: number;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  localUri: string | null;
  localState: LocalTransferState;
  /** Operational worker state for FINALIZING display — not persisted raw to UI elsewhere. */
  workerState?: import('@/api').DownloadWorkerState | null;
  /** Engine-owned execution phase for UI projection (Phase 1C). */
  executionState?: import('../execution/download-execution-state').DownloadExecutionState | null;
  /** Worker generation — stale callbacks must not mutate execution. */
  generation?: number;
  /** Bytes already on disk when this transfer attempt began (resume baseline). */
  attemptStartBytes?: number;
  /**
   * Engine-owned: whether this source can continue from a partial file.
   * Omitted means unknown — UI must assume Pause is allowed. Explicit `false`
   * (e.g. social CDNs on signed links) suppresses Pause so a pause cannot
   * strand progress the source will refuse to resume.
   */
  supportsResume?: boolean;
  errorCode: DownloadEngineErrorCode | null;
  errorMessage: string | null;
};

export type LocalDownloadRecord = {
  downloadId: string;
  sourceUrl: string;
  fileName: string;
  expectedFileSize: string;
  localUri: string | null;
  localState: LocalTransferState;
  bytesWritten: number;
  totalBytes: number | null;
  pauseState: DownloadPauseState | null;
  /** ETag / Last-Modified captured for If-Range resume (local only). */
  rangeValidators: RangeValidators | null;
  generation: number;
  errorCode: DownloadEngineErrorCode | null;
  errorMessage: string | null;
  remoteStatus: DownloadStatus | null;
  /** Auto-retries already started after failures. */
  retryCount: number;
  maxRetries: number;
  /** Manual Retry allowed for this failure. */
  retryEligible: boolean;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  updatedAt: string;
  /** Bounded HLS transfer checkpoint (local only). */
  hlsTransfer?: HlsTransferState | null;
  /** Compact multi-range progressive checkpoint (local only). */
  multiRange?: MultiRangeTransferState | null;
  /** Explicit pause origin — USER pauses are not auto-resumed by network policy. */
  pauseReason?: DownloadPauseReason | null;
  /**
   * Non-secret Phase 6C flag — session-bound jobs need in-memory execution context.
   * Never stores Cookie/Authorization; used after process death to fail safely.
   */
  requiresEphemeralSession?: boolean;
};

/** Per-part status for multi-range progressive downloads. */
export type MultiRangePartStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type MultiRangePartState = {
  index: number;
  rangeStart: number;
  rangeEnd: number;
  downloadedBytes: number;
  status: MultiRangePartStatus;
  retryCount: number;
  lastFailureReason: string | null;
};

/** Compact multi-range job checkpoint — no response bodies. */
export type MultiRangeTransferState = {
  contentLength: number;
  workerCount: number;
  sourceValidators: RangeValidators | null;
  parts: MultiRangePartState[];
  failedPart: number | null;
};

export type EnqueueInput = {
  id: string;
  sourceUrl: string;
  fileName: string;
  fileSize: string;
  title?: string;
  /** When true, skip auto-start (recovery of paused items). */
  preferPaused?: boolean;
  /**
   * Verified analyze / Phase 5B stream type.
   * Prefer this over `.m3u8` URL heuristics when routing HLS vs progressive.
   */
  streamType?: 'HLS' | 'PROGRESSIVE' | 'AUDIO' | 'DASH' | null;
  /** In-memory session context — never persisted to catalog. */
  requestContext?: import('@/downloads/types/request-context').MediaRequestContext | null;
  /**
   * Stable social media/variant identity for Phase 4C source refresh.
   * Ephemeral — never persisted; no signed URLs or session secrets.
   */
  socialSourceIdentity?: import('./social-source-refresh.provider').SocialSourceRefreshIdentity | null;
};

export type EngineEvent =
  | { type: 'progress'; snapshot: TransferProgressSnapshot }
  | {
      type: 'status';
      downloadId: string;
      status: DownloadStatus;
      workerState?: import('@/api').DownloadWorkerState | null;
      executionState?: import('../execution/download-execution-state').DownloadExecutionState | null;
      errorMessage?: string | null;
    }
  | {
      type: 'completed';
      downloadId: string;
      localUri: string;
      fileSize: string;
      progress: number;
      /** Final basename after Phase 7A identity normalization. */
      fileName?: string;
      mimeType?: string | null;
      container?: string | null;
    }
  | { type: 'failed'; downloadId: string; code: DownloadEngineErrorCode; message: string }
  | { type: 'cancelled'; downloadId: string }
  | { type: 'removed'; downloadId: string };
