/** Single versioned SecureStore key for the committed App Lock record. */
export const APP_LOCK_SECURE_STORE_KEY = 'vidorax.appLock.v1' as const;

/** Keep schemaVersion 1 so Phase 1 records remain valid; Phase 2 adds optional fields. */
export const APP_LOCK_SCHEMA_VERSION = 1 as const;

export const APP_LOCK_PIN_LENGTH = 4 as const;

/** Current PIN/recovery verifier algorithm id (migration-ready; not a strong offline KDF). */
export const APP_LOCK_VERIFIER_VERSION = 'sha256-v1' as const;

/** Unambiguous uppercase alphabet (no 0/O/1/I/L). Size 31. */
export const APP_LOCK_RECOVERY_ALPHABET =
  'ABCDEFGHJKMNPQRSTUVWXYZ23456789' as const;

/**
 * Recovery code body length (excluding separators).
 * Entropy: 26 × log2(31) ≈ 128.81 bits (documented accurately).
 */
export const APP_LOCK_RECOVERY_BODY_LENGTH = 26 as const;

export const APP_LOCK_SALT_BYTES = 16 as const;

export const APP_LOCK_DERIVE_CONTEXT_PIN = 'pin' as const;
export const APP_LOCK_DERIVE_CONTEXT_RECOVERY = 'recovery' as const;

/** PIN failure delays (ms). Attempts 1–4: none; then progressive to 30s cap. */
export const APP_LOCK_PIN_THROTTLE_DELAYS_MS = {
  after5: 10_000,
  after6: 20_000,
  after7Plus: 30_000,
} as const;

export const APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD = 5 as const;

/** Recovery failure delays (ms) — same progressive shape, separate counters. */
export const APP_LOCK_RECOVERY_THROTTLE_DELAYS_MS = {
  after5: 10_000,
  after6: 20_000,
  after7Plus: 30_000,
} as const;

export const APP_LOCK_RECOVERY_THROTTLE_SOFT_THRESHOLD = 5 as const;
