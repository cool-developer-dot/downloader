/** Limits for basic unencrypted HLS transfer — keep device memory/network bounded. */

export const HLS_TRANSFER = {
  /** Max playlist body size (bytes). */
  maxPlaylistBytes: 1_500_000,
  /** Max media segments in one VOD playlist. */
  maxSegments: 2_500,
  /** Per-playlist / per-segment HTTP timeout. */
  requestTimeoutMs: 45_000,
  /**
   * Bounded retries for a single failed segment (attempts after the first).
   * Aligns with DOWNLOAD_ENGINE.maxAutoRetryAttempts.
   */
  segmentRetryCount: 3,
  /** Base delay between segment retries (ms); exponential, capped. */
  segmentRetryBaseMs: 1_000,
  segmentRetryMaxMs: 8_000,
  /** Local persist: every N completed segments. */
  persistEveryNSegments: 8,
  /** Local persist: at most this often while transferring. */
  persistIntervalMs: 4_000,
  /** Refuse a single segment larger than this (bytes). */
  maxSegmentBytes: 32 * 1024 * 1024,
  /** Workspace folder name under the download item directory. */
  workspaceFolderName: '.hls',
  /** Assembled temp filename before final rename. */
  tempOutputName: 'assemble.tmp',
  /** Chunk size for assembly copy (bytes). */
  assemblyChunkBytes: 256 * 1024,
} as const;
