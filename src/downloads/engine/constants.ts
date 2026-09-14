/** Fallback concurrency when policy is unavailable — keep in sync with DEFAULT_DOWNLOAD_SETTINGS. */
export const MAX_CONCURRENT_DOWNLOADS = 2;

export const MIN_CONCURRENT_DOWNLOADS = 1;
export const MAX_ALLOWED_CONCURRENT_DOWNLOADS = 4;

/** Bounded automatic retries after a retryable failure. */
export const MAX_AUTO_RETRY_ATTEMPTS = 3;

/** Suffix for in-progress progressive transfer files (same directory as final). */
export const TRANSFER_PARTIAL_SUFFIX = '.part';

export const DOWNLOAD_ENGINE = {
  /**
   * Fallback concurrency ceiling for ALL strategies (progressive + HLS).
   * Prefer getEffectiveMaxConcurrentDownloads() from download settings policy.
   */
  maxConcurrentDownloads: MAX_CONCURRENT_DOWNLOADS,
  /** Minimum interval between Zustand progress patches. */
  uiProgressIntervalMs: 250,
  /** Minimum interval between durable progress emissions (legacy name). */
  backendProgressIntervalMs: 2500,
  /** Root folder under Paths.document. */
  rootFolderName: 'VidoraXDownloads',
  /** AsyncStorage key for local transfer records. */
  persistenceKey: 'vidorax.downloads.engine.v1',
  /** Refuse starting when free disk is below this (bytes). */
  minFreeDiskBytes: 8 * 1024 * 1024,
  /** Extra safety margin on top of remaining bytes for disk precheck. */
  diskSafetyMarginBytes: 4 * 1024 * 1024,
  /** Auto-retry budget after a retryable failure. */
  maxAutoRetryAttempts: MAX_AUTO_RETRY_ATTEMPTS,
  /** Base delay for exponential backoff (attempt 1 → 1s). */
  retryBackoffBaseMs: 1_000,
  /** Cap for exponential backoff and Retry-After. */
  retryBackoffMaxMs: 60_000,
  /**
   * Per-file multi-range acceleration (progressive only).
   * Separate from queue concurrency (maxConcurrentDownloads).
   */
  maxRangesPerFile: 4,
  /** Hard cap on simultaneous HTTP range requests across all downloads. */
  maxGlobalNetworkWorkers: 6,
  /** Below this size, multi-range is never used. */
  minMultiRangeBytes: 8 * 1024 * 1024,
  /** Prefer 2 workers at/above this size. */
  multiRangeMediumBytes: 32 * 1024 * 1024,
  /** Prefer up to 4 workers at/above this size. */
  multiRangeLargeBytes: 128 * 1024 * 1024,
  /** Extra disk margin for part files + merge temp (on top of remaining). */
  multiRangeDiskMarginBytes: 16 * 1024 * 1024,
  /** Persist multi-range checkpoints at most this often. */
  multiRangePersistIntervalMs: 3_000,
  /** No byte progress for this long → transfer stall (ms). */
  transferStallInactivityMs: 45_000,
  /** Max time allowed in finalization/validation (ms). */
  finalizationTimeoutMs: 30_000,
  /** Stall watchdog poll interval (ms). */
  stallCheckIntervalMs: 2_000,
  /** Connection establishment timeout for social fetch (ms). */
  socialConnectTimeoutMs: 20_000,
  /** First-byte timeout after connection (ms). */
  socialFirstByteTimeoutMs: 30_000,
  /** Max bytes for signature / MIME prefix probes. */
  signatureProbeMaxBytes: 16 * 1024,
  /** Max bytes for generic bounded HTTP probes (Range fallback). */
  boundedProbeMaxBytes: 16 * 1024,
  /**
   * Pause must not wait forever for native downloadAsync() after the transfer
   * has already been signalled to stop. Bound so UI mutating cannot stick.
   */
  pauseSettleTimeoutMs: 6_000,
} as const;
