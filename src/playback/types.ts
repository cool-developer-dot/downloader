/**
 * Canonical local playback state (mediaId-keyed).
 * No filesystem URI / source URL.
 *
 * Authority:
 * - Device: active progress, local file availability, newer unsynced offline state
 * - Backend: durable account history, ownership, server updatedAt
 */
export type PlaybackState = {
  mediaId: string;
  positionSeconds: number;
  durationSeconds: number;
  progressPercent: number;
  lastPlayedAt: string | null;
  completed: boolean;
  updatedAt: string;
  pendingSync: boolean;
  /** Monotonic local revision — tie-breaker + stale sync guard. */
  clientRevision: number;
};

export type PlaybackProgressInput = {
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
  lastPlayedAt?: string | null;
  markCompleted?: boolean;
};
