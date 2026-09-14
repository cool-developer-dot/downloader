/** Bounded limits for on-device media URL analysis (Phase 1B). */

export const LOCAL_ANALYZE = {
  /** Overall request timeout (ms). */
  timeoutMs: 10_000,
  /** Max playlist body for analyze (bytes) — tighter than transfer. */
  maxManifestBytes: 512_000,
  /** Max HLS master variants returned. */
  maxHlsVariants: 64,
  /** Sanity cap for estimated sizes. */
  maxEstimatedBytes: 50 * 1024 * 1024 * 1024,
} as const;
