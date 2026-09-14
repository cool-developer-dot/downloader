/**
 * Phase 2 — execution ownership & background display types.
 * Device-local / derived only. Never persisted to PostgreSQL.
 */

/** Who transfers bytes for a download id. Phase 2: JS owns transfer. */
export type ExecutionOwner = 'JS' | 'ANDROID_NATIVE' | 'NONE';

export type BackgroundExecutionSnapshot = {
  running: boolean;
  activeDownloadIds: string[];
  serviceStartedAt: number | null;
  /** Optional operational mode for diagnostics / Phase 3 hooks. */
  executionMode?: 'JS_TRANSFER_FGS' | 'NATIVE_TRANSFER' | 'UNAVAILABLE';
};

export type BackgroundExecutionErrorCode =
  | 'FOREGROUND_SERVICE_START_FAILED'
  | 'NATIVE_EXECUTION_UNAVAILABLE'
  | 'BACKGROUND_EXECUTION_UNAVAILABLE';

export type BackgroundExecutionError = {
  code: BackgroundExecutionErrorCode;
  /** Safe, non-exception message for logs / ops — never raw Java text. */
  message: string;
};

/**
 * Derived presentation state — not DownloadStatus, not WorkerState.
 * Do not persist to backend.
 */
export type DownloadExecutionDisplayState =
  | 'STARTING'
  | 'DOWNLOADING_FOREGROUND'
  | 'DOWNLOADING_BACKGROUND'
  | 'WAITING_FOR_WIFI'
  | 'WAITING_FOR_CONNECTION'
  | 'WAITING_FOR_RETRY'
  | 'WAITING_CAPACITY'
  | 'PREPARING'
  | 'PAUSED'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'QUEUED';

export const DOWNLOAD_EXECUTION_DISPLAY_COPY: Record<
  DownloadExecutionDisplayState,
  string
> = {
  STARTING: 'Starting download',
  DOWNLOADING_FOREGROUND: 'Downloading',
  DOWNLOADING_BACKGROUND: 'Downloading in background',
  WAITING_FOR_WIFI: 'Waiting for Wi-Fi',
  WAITING_FOR_CONNECTION: 'Waiting for network',
  WAITING_FOR_RETRY: 'Retrying',
  WAITING_CAPACITY: 'Queued',
  PREPARING: 'Preparing download',
  PAUSED: 'Paused',
  FINALIZING: 'Finalizing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  QUEUED: 'Queued',
};

export function formatDownloadExecutionDisplayState(
  state: DownloadExecutionDisplayState,
): string {
  return DOWNLOAD_EXECUTION_DISPLAY_COPY[state];
}
