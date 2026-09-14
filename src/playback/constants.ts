/**
 * Week 8 Day 3 Phase 1 — playback persistence constants.
 */

/** Local MMKV/AsyncStorage write budget (periodic + kill-safety). */
export const PLAYBACK_LOCAL_PERSIST_INTERVAL_MS = 5_000;

/** Backend PUT coalesce budget — latest state only. */
export const PLAYBACK_BACKEND_SYNC_INTERVAL_MS = 15_000;

/** Progress ≥ this % → near-end completed (persisted progress). */
export const PLAYBACK_COMPLETED_PROGRESS_PERCENT = 95;

/** Remaining ≤ this → near-end completed when duration is long enough. */
export const PLAYBACK_COMPLETED_REMAINING_SECONDS = 30;

/** Remaining-seconds rule requires at least this duration. */
export const PLAYBACK_MIN_DURATION_FOR_REMAINING_RULE = 60;

/** Player timing overshoot tolerance for validation. */
export const PLAYBACK_POSITION_DURATION_TOLERANCE_SECONDS = 2;

/** Key prefix: playback:<namespace>:<mediaId> */
export const PLAYBACK_STORAGE_KEY_PREFIX = 'vidorax.playback.v1';

/**
 * Stable device-local namespace. Not a user/account identity.
 * Frozen Phase 2: keys are vidorax.playback.v1:local:<mediaId>
 */
export const PLAYBACK_LOCAL_NAMESPACE = 'local';

/** Minimum saved position before offering Resume. */
export const PLAYBACK_MIN_RESUME_SECONDS = 15;

/**
 * After intentional Replay/Start Over, clear sticky completed when
 * actual playback resumes below this position.
 */
export const PLAYBACK_REPLAY_RESET_MAX_SECONDS = 15;

/** Default page size for watch history lists. */
export const PLAYBACK_HISTORY_PAGE_SIZE = 20;

/**
 * Reject client timestamps farther in the future than this skew window.
 * Protects against a wildly future device clock dominating reconciliation.
 */
export const PLAYBACK_CLIENT_TIMESTAMP_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Max pending media to sync on reconnect in one wave. */
export const PLAYBACK_RECONNECT_SYNC_BATCH_LIMIT = 25;
