import type {
  APP_LOCK_SCHEMA_VERSION,
  APP_LOCK_VERIFIER_VERSION,
} from './app-lock.constants';

export type AppLockStatus = 'DISABLED' | 'LOCKED' | 'UNLOCKED';

/** Bootstrap integrity outcomes after SecureStore read. */
export type AppLockBootstrapKind =
  | 'disabled'
  | 'locked'
  | 'corrupt_enabled'
  | 'secure_store_error';

export type AppLockVerifierVersion = typeof APP_LOCK_VERIFIER_VERSION;

export type AppLockCommittedRecord = {
  enabled: true;
  schemaVersion: typeof APP_LOCK_SCHEMA_VERSION;
  pinSalt: string;
  pinVerifier: string;
  recoverySalt: string;
  recoveryVerifier: string;
  /** Migration-ready algorithm id. Defaults to sha256-v1 for Phase 1 records. */
  pinVerifierVersion: AppLockVerifierVersion;
  recoveryVerifierVersion: AppLockVerifierVersion;
  /** Persisted throttle metadata — no secrets. */
  pinFailedAttempts: number;
  /** Epoch ms when PIN entry may resume; null if not throttled. */
  pinRetryAfter: number | null;
  recoveryFailedAttempts: number;
  recoveryRetryAfter: number | null;
};

export type AppLockStorageReadResult =
  | { kind: 'missing' }
  | { kind: 'valid'; record: AppLockCommittedRecord }
  | { kind: 'corrupt_enabled'; reason: string }
  | { kind: 'discardable'; reason: string }
  | { kind: 'read_error'; message: string };

export type AppLockSetupSession = {
  pinVerifier: string;
  pinSalt: string;
  recoveryVerifier: string;
  recoverySalt: string;
  /** Plaintext recovery — memory only; never persist. */
  recoveryCodePlaintext: string;
};

/** In-memory recovery rotation until acknowledgement. */
export type AppLockRecoveryRotationSession = {
  recoveryVerifier: string;
  recoverySalt: string;
  recoveryCodePlaintext: string;
};

export type AppLockVerifyFailureReason =
  | 'mismatch'
  | 'error'
  | 'not_configured'
  | 'throttled'
  | 'invalid_input';

export type AppLockVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason: AppLockVerifyFailureReason;
      retryAfter?: number | null;
    };

export type PinValidationResult =
  | { ok: true; pin: string }
  | { ok: false; reason: 'empty' | 'length' | 'non_digit' };

export type LockedSurface = 'unlock' | 'forgot';
