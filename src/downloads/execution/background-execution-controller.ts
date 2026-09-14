import type {
  BackgroundExecutionError,
  BackgroundExecutionSnapshot,
} from './types';

/**
 * Narrow platform abstraction for Android FGS liveness.
 * Non-Android → no-op. Does not schedule downloads.
 */
export type BackgroundExecutionController = {
  /** Idempotent: ensure one FGS instance is running. */
  ensureRunning(): Promise<{
    ok: boolean;
    error?: BackgroundExecutionError;
  }>;

  /** Replace native active-job registry (download IDs only). */
  updateActiveJobs(downloadIds: readonly string[]): Promise<BackgroundExecutionSnapshot>;

  /** Stop FGS when native registry is empty. */
  stopIfIdle(): Promise<BackgroundExecutionSnapshot>;

  getSnapshot(): Promise<BackgroundExecutionSnapshot>;

  /**
   * Update ongoing FGS notification content (throttled by JS caller).
   * No-op on platforms without FGS.
   */
  updateNotificationSummary?(summary: {
    activeCount: number;
    waitingCount: number;
    title: string | null;
    progressPercent: number | null;
    bytesDownloaded: number | null;
    totalBytes: number | null;
    indeterminate: boolean;
  }): Promise<void>;

  /**
   * Subscribe to sparse lifecycle events.
   * Returns unsubscribe. Safe no-op when unsupported.
   */
  subscribe(
    listener: (event: {
      type:
        | 'SERVICE_STARTED'
        | 'SERVICE_STOPPED'
        | 'ACTIVE_JOBS_CHANGED'
        | 'SERVICE_ERROR';
      snapshot: BackgroundExecutionSnapshot;
      error?: BackgroundExecutionError;
    }) => void,
  ): () => void;
};

export const EMPTY_BACKGROUND_SNAPSHOT: BackgroundExecutionSnapshot = {
  running: false,
  activeDownloadIds: [],
  serviceStartedAt: null,
  executionMode: 'UNAVAILABLE',
};
