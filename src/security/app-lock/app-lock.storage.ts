import {
  APP_LOCK_SCHEMA_VERSION,
  APP_LOCK_SECURE_STORE_KEY,
  APP_LOCK_VERIFIER_VERSION,
} from './app-lock.constants';
import type { AppLockCommittedRecord, AppLockStorageReadResult } from './types';

export type SecureStoreLike = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function looksLikeHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length >= 16;
}

function parseNonNegInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return fallback;
}

function parseRetryAfter(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return null;
}

function parseVerifierVersion(value: unknown): typeof APP_LOCK_VERIFIER_VERSION {
  if (value === APP_LOCK_VERIFIER_VERSION || value == null || value === undefined) {
    return APP_LOCK_VERIFIER_VERSION;
  }
  // Unknown future versions: still treat as present string for fail-closed if needed later.
  // Phase 2 only supports sha256-v1; unknown non-empty string is corrupt for enabled records.
  if (typeof value === 'string' && value.length > 0 && value !== APP_LOCK_VERIFIER_VERSION) {
    // Allow read as sha256-v1 only; mark via returning the known version only if matches.
    // Caller treats unknown as corrupt below.
  }
  return APP_LOCK_VERIFIER_VERSION;
}

function isKnownVerifierVersion(value: unknown): boolean {
  return value == null || value === undefined || value === APP_LOCK_VERIFIER_VERSION;
}

/**
 * Normalize a valid core Phase 1/2 payload into a full committed record.
 */
export function normalizeCommittedRecord(
  obj: Record<string, unknown>,
): AppLockCommittedRecord | null {
  const hasPinSalt = isNonEmptyString(obj.pinSalt) && looksLikeHex(obj.pinSalt);
  const hasPinVerifier = isNonEmptyString(obj.pinVerifier) && looksLikeHex(obj.pinVerifier);
  const hasRecoverySalt =
    isNonEmptyString(obj.recoverySalt) && looksLikeHex(obj.recoverySalt);
  const hasRecoveryVerifier =
    isNonEmptyString(obj.recoveryVerifier) && looksLikeHex(obj.recoveryVerifier);
  const schemaOk = obj.schemaVersion === APP_LOCK_SCHEMA_VERSION;

  if (
    !schemaOk ||
    !hasPinSalt ||
    !hasPinVerifier ||
    !hasRecoverySalt ||
    !hasRecoveryVerifier
  ) {
    return null;
  }

  if (!isKnownVerifierVersion(obj.pinVerifierVersion) || !isKnownVerifierVersion(obj.recoveryVerifierVersion)) {
    return null;
  }

  return {
    enabled: true,
    schemaVersion: APP_LOCK_SCHEMA_VERSION,
    pinSalt: obj.pinSalt as string,
    pinVerifier: obj.pinVerifier as string,
    recoverySalt: obj.recoverySalt as string,
    recoveryVerifier: obj.recoveryVerifier as string,
    pinVerifierVersion: parseVerifierVersion(obj.pinVerifierVersion),
    recoveryVerifierVersion: parseVerifierVersion(obj.recoveryVerifierVersion),
    pinFailedAttempts: parseNonNegInt(obj.pinFailedAttempts, 0),
    pinRetryAfter: parseRetryAfter(obj.pinRetryAfter),
    recoveryFailedAttempts: parseNonNegInt(obj.recoveryFailedAttempts, 0),
    recoveryRetryAfter: parseRetryAfter(obj.recoveryRetryAfter),
  };
}

/**
 * Classify a parsed SecureStore payload.
 * Phase 1 records without throttle/version fields remain valid (defaults applied).
 * enabled:true with incomplete/invalid fields → corrupt_enabled (fail closed).
 */
export function classifyAppLockPayload(raw: string | null): AppLockStorageReadResult {
  if (raw == null || raw.trim() === '') {
    return { kind: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { kind: 'corrupt_enabled', reason: 'malformed_json' };
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'corrupt_enabled', reason: 'invalid_shape' };
  }

  const obj = parsed as Record<string, unknown>;
  const enabled = obj.enabled === true;
  const normalized = normalizeCommittedRecord(obj);

  if (enabled && normalized) {
    return { kind: 'valid', record: normalized };
  }

  if (enabled) {
    return { kind: 'corrupt_enabled', reason: 'incomplete_enabled_record' };
  }

  return { kind: 'discardable', reason: 'incomplete_non_enabled' };
}

export async function readAppLockRecord(
  store: SecureStoreLike,
): Promise<AppLockStorageReadResult> {
  try {
    const raw = await store.getItemAsync(APP_LOCK_SECURE_STORE_KEY);
    return classifyAppLockPayload(raw);
  } catch (error) {
    return {
      kind: 'read_error',
      message: error instanceof Error ? error.message : 'secure_store_read_failed',
    };
  }
}

export async function writeAppLockRecord(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
): Promise<void> {
  const payload = JSON.stringify(record);
  await store.setItemAsync(APP_LOCK_SECURE_STORE_KEY, payload);
}

export async function deleteAppLockRecord(store: SecureStoreLike): Promise<void> {
  await store.deleteItemAsync(APP_LOCK_SECURE_STORE_KEY);
}

export function getAppLockSecureStoreKey(): string {
  return APP_LOCK_SECURE_STORE_KEY;
}

export function createDefaultThrottleFields(): Pick<
  AppLockCommittedRecord,
  | 'pinVerifierVersion'
  | 'recoveryVerifierVersion'
  | 'pinFailedAttempts'
  | 'pinRetryAfter'
  | 'recoveryFailedAttempts'
  | 'recoveryRetryAfter'
> {
  return {
    pinVerifierVersion: APP_LOCK_VERIFIER_VERSION,
    recoveryVerifierVersion: APP_LOCK_VERIFIER_VERSION,
    pinFailedAttempts: 0,
    pinRetryAfter: null,
    recoveryFailedAttempts: 0,
    recoveryRetryAfter: null,
  };
}
