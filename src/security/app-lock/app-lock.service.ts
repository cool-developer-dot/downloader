import {
  derivePinVerifier,
  deriveRecoveryVerifier,
  generateRecoveryCode,
  generateSaltHex,
  validatePinInput,
} from './app-lock.crypto';
import {
  APP_LOCK_SCHEMA_VERSION,
  APP_LOCK_VERIFIER_VERSION,
} from './app-lock.constants';
import { decideBootstrap } from './app-lock-policy';
import {
  clearedThrottleState,
  nextFailureThrottle,
  resolveAttemptPolicy,
} from './app-lock-throttle';
import {
  createDefaultThrottleFields,
  deleteAppLockRecord,
  readAppLockRecord,
  writeAppLockRecord,
  type SecureStoreLike,
} from './app-lock.storage';
import { appLockTrace } from './app-lock-trace';
import type {
  AppLockCommittedRecord,
  AppLockRecoveryRotationSession,
  AppLockSetupSession,
  AppLockVerifyFailureReason,
  AppLockVerifyResult,
} from './types';
import { verifiersEqual } from './app-lock.crypto';

let defaultStore: SecureStoreLike | null = null;

export function getDefaultSecureStore(): SecureStoreLike {
  if (defaultStore) {
    return defaultStore;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require('expo-secure-store') as SecureStoreLike;
  defaultStore = SecureStore;
  return SecureStore;
}

export function setAppLockSecureStoreForTests(store: SecureStoreLike | null): void {
  defaultStore = store;
}

export type BootstrapServiceResult =
  | { status: 'DISABLED' }
  | { status: 'LOCKED'; record: AppLockCommittedRecord }
  | { status: 'CORRUPT_ENABLED'; reason: string }
  | { status: 'SECURE_STORE_ERROR'; message: string };

export async function bootstrapAppLock(
  store: SecureStoreLike = getDefaultSecureStore(),
): Promise<BootstrapServiceResult> {
  appLockTrace('BOOTSTRAP_STARTED');
  const read = await readAppLockRecord(store);
  const decision = decideBootstrap(read);

  if (decision.kind === 'disabled') {
    if (decision.cleaned && read.kind === 'discardable') {
      try {
        await deleteAppLockRecord(store);
      } catch {
        // Best-effort cleanup of non-enabled junk.
      }
    }
    appLockTrace('BOOTSTRAP_DISABLED');
    return { status: 'DISABLED' };
  }

  if (decision.kind === 'locked' && read.kind === 'valid') {
    appLockTrace('BOOTSTRAP_LOCKED');
    return { status: 'LOCKED', record: read.record };
  }

  if (decision.kind === 'corrupt_enabled') {
    appLockTrace('BOOTSTRAP_CORRUPT');
    return { status: 'CORRUPT_ENABLED', reason: decision.reason };
  }

  appLockTrace('BOOTSTRAP_SECURE_STORE_ERROR');
  return {
    status: 'SECURE_STORE_ERROR',
    message: decision.kind === 'secure_store_error' ? decision.message : 'unknown',
  };
}

let setupInFlight: Promise<AppLockSetupSession> | null = null;
let commitInFlight: Promise<void> | null = null;
let unlockInFlight: Promise<AppLockVerifyResult> | null = null;
let disableInFlight: Promise<AppLockVerifyResult> | null = null;
let changePinInFlight: Promise<AppLockVerifyResult> | null = null;
let recoveryVerifyInFlight: Promise<AppLockVerifyResult> | null = null;
let recoveryResetInFlight: Promise<AppLockVerifyResult> | null = null;
let recoveryRotationInFlight: Promise<AppLockVerifyResult> | null = null;

let activeSetup: AppLockSetupSession | null = null;
let activeRecoveryRotation: AppLockRecoveryRotationSession | null = null;
/** Set after successful recovery verify; cleared on commit/cancel/background. */
let recoveryAuthGranted = false;
let cachedRecord: AppLockCommittedRecord | null = null;

export function getActiveSetupSession(): AppLockSetupSession | null {
  return activeSetup;
}

export function getActiveRecoveryRotationSession(): AppLockRecoveryRotationSession | null {
  return activeRecoveryRotation;
}

export function isRecoveryAuthGranted(): boolean {
  return recoveryAuthGranted;
}

export function getCachedAppLockRecord(): AppLockCommittedRecord | null {
  return cachedRecord;
}

export function setCachedAppLockRecord(record: AppLockCommittedRecord | null): void {
  cachedRecord = record;
}

export function cancelSetupSession(): void {
  activeSetup = null;
  setupInFlight = null;
  appLockTrace('SETUP_CANCELLED');
}

export function cancelRecoveryRotationSession(): void {
  activeRecoveryRotation = null;
  recoveryRotationInFlight = null;
  appLockTrace('RECOVERY_ROTATION_CANCELLED');
}

export function clearRecoveryAuth(): void {
  recoveryAuthGranted = false;
}

/** Clear all sensitive in-memory sessions (background / lock). */
export function clearSensitiveEphemeralState(): void {
  cancelSetupSession();
  cancelRecoveryRotationSession();
  clearRecoveryAuth();
}

async function loadRecord(
  store: SecureStoreLike,
): Promise<AppLockCommittedRecord | null> {
  if (cachedRecord) {
    return cachedRecord;
  }
  const read = await readAppLockRecord(store);
  if (read.kind !== 'valid') {
    return null;
  }
  cachedRecord = read.record;
  return read.record;
}

async function persistRecord(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
): Promise<void> {
  await writeAppLockRecord(store, record);
  cachedRecord = record;
}

function withDefaults(partial: {
  pinSalt: string;
  pinVerifier: string;
  recoverySalt: string;
  recoveryVerifier: string;
} & Partial<AppLockCommittedRecord>): AppLockCommittedRecord {
  const defaults = createDefaultThrottleFields();
  return {
    enabled: true,
    schemaVersion: APP_LOCK_SCHEMA_VERSION,
    pinSalt: partial.pinSalt,
    pinVerifier: partial.pinVerifier,
    recoverySalt: partial.recoverySalt,
    recoveryVerifier: partial.recoveryVerifier,
    pinVerifierVersion: partial.pinVerifierVersion ?? defaults.pinVerifierVersion,
    recoveryVerifierVersion:
      partial.recoveryVerifierVersion ?? defaults.recoveryVerifierVersion,
    pinFailedAttempts: partial.pinFailedAttempts ?? 0,
    pinRetryAfter: partial.pinRetryAfter ?? null,
    recoveryFailedAttempts: partial.recoveryFailedAttempts ?? 0,
    recoveryRetryAfter: partial.recoveryRetryAfter ?? null,
  };
}

export async function beginSetupPrepare(
  pin: string,
  confirmPin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
): Promise<
  | { ok: true; session: AppLockSetupSession }
  | { ok: false; reason: 'pin_invalid' | 'mismatch' | 'busy' | 'error' }
> {
  void store;
  if (setupInFlight) {
    return { ok: false, reason: 'busy' };
  }

  const pinResult = validatePinInput(pin);
  const confirmResult = validatePinInput(confirmPin);
  if (!pinResult.ok || !confirmResult.ok) {
    return { ok: false, reason: 'pin_invalid' };
  }
  if (pinResult.pin !== confirmResult.pin) {
    return { ok: false, reason: 'mismatch' };
  }

  appLockTrace('SETUP_STARTED');
  appLockTrace('PIN_CONFIRMED');

  setupInFlight = (async () => {
    const pinSalt = await generateSaltHex();
    const recoverySalt = await generateSaltHex();
    const recoveryCodePlaintext = await generateRecoveryCode();
    const pinVerifier = await derivePinVerifier(pinSalt, pinResult.pin);
    const recoveryVerifier = await deriveRecoveryVerifier(
      recoverySalt,
      recoveryCodePlaintext,
    );
    appLockTrace('RECOVERY_GENERATED');
    const session: AppLockSetupSession = {
      pinSalt,
      pinVerifier,
      recoverySalt,
      recoveryVerifier,
      recoveryCodePlaintext,
    };
    activeSetup = session;
    return session;
  })();

  try {
    const session = await setupInFlight;
    return { ok: true, session };
  } catch {
    activeSetup = null;
    return { ok: false, reason: 'error' };
  } finally {
    setupInFlight = null;
  }
}

export async function completeSetupCommit(
  acknowledged: boolean,
  store: SecureStoreLike = getDefaultSecureStore(),
): Promise<{ ok: true } | { ok: false; reason: 'not_ready' | 'not_acked' | 'busy' | 'error' }> {
  if (!acknowledged) {
    return { ok: false, reason: 'not_acked' };
  }
  if (!activeSetup) {
    return { ok: false, reason: 'not_ready' };
  }
  if (commitInFlight) {
    return { ok: false, reason: 'busy' };
  }

  const session = activeSetup;
  commitInFlight = (async () => {
    const record = withDefaults({
      pinSalt: session.pinSalt,
      pinVerifier: session.pinVerifier,
      recoverySalt: session.recoverySalt,
      recoveryVerifier: session.recoveryVerifier,
      ...createDefaultThrottleFields(),
    });
    await persistRecord(store, record);
    activeSetup = null;
    appLockTrace('SETUP_COMMITTED');
  })();

  try {
    await commitInFlight;
    return { ok: true };
  } catch {
    appLockTrace('SECURE_STORAGE_ERROR');
    return { ok: false, reason: 'error' };
  } finally {
    commitInFlight = null;
  }
}

export async function verifyPinAgainstRecord(
  pin: string,
  record: AppLockCommittedRecord,
): Promise<AppLockVerifyResult> {
  const validated = validatePinInput(pin);
  if (!validated.ok) {
    return { ok: false, reason: 'invalid_input' };
  }
  try {
    const derived = await derivePinVerifier(record.pinSalt, validated.pin);
    if (!verifiersEqual(derived, record.pinVerifier)) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function verifyRecoveryCode(
  input: string,
  record: AppLockCommittedRecord = cachedRecord!,
): Promise<AppLockVerifyResult> {
  if (!record) {
    return { ok: false, reason: 'not_configured' };
  }
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (!trimmed) {
    return { ok: false, reason: 'invalid_input' };
  }
  try {
    const derived = await deriveRecoveryVerifier(record.recoverySalt, trimmed);
    if (!verifiersEqual(derived, record.recoveryVerifier)) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

async function recordPinFailure(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
  now: number,
): Promise<AppLockCommittedRecord> {
  const next = nextFailureThrottle({
    channel: 'pin',
    previousAttempts: record.pinFailedAttempts,
    now,
  });
  const updated: AppLockCommittedRecord = {
    ...record,
    pinFailedAttempts: next.failedAttempts,
    pinRetryAfter: next.retryAfter,
  };
  try {
    await persistRecord(store, updated);
    if (next.delayMs > 0) {
      appLockTrace('PIN_THROTTLED');
    }
  } catch {
    appLockTrace('SECURE_STORAGE_ERROR');
    // Keep in-memory throttle even if persist fails.
    cachedRecord = updated;
  }
  return updated;
}

async function recordRecoveryFailure(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
  now: number,
): Promise<AppLockCommittedRecord> {
  const next = nextFailureThrottle({
    channel: 'recovery',
    previousAttempts: record.recoveryFailedAttempts,
    now,
  });
  const updated: AppLockCommittedRecord = {
    ...record,
    recoveryFailedAttempts: next.failedAttempts,
    recoveryRetryAfter: next.retryAfter,
  };
  try {
    await persistRecord(store, updated);
    if (next.delayMs > 0) {
      appLockTrace('RECOVERY_THROTTLED');
    }
  } catch {
    appLockTrace('SECURE_STORAGE_ERROR');
    cachedRecord = updated;
  }
  return updated;
}

async function clearPinThrottle(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
): Promise<void> {
  if (record.pinFailedAttempts === 0 && record.pinRetryAfter == null) {
    return;
  }
  const cleared = clearedThrottleState();
  const updated: AppLockCommittedRecord = {
    ...record,
    pinFailedAttempts: cleared.failedAttempts,
    pinRetryAfter: cleared.retryAfter,
  };
  try {
    await persistRecord(store, updated);
  } catch {
    cachedRecord = updated;
  }
}

async function clearBothThrottles(
  store: SecureStoreLike,
  record: AppLockCommittedRecord,
): Promise<void> {
  const updated: AppLockCommittedRecord = {
    ...record,
    pinFailedAttempts: 0,
    pinRetryAfter: null,
    recoveryFailedAttempts: 0,
    recoveryRetryAfter: null,
  };
  try {
    await persistRecord(store, updated);
  } catch {
    cachedRecord = updated;
  }
}

export async function unlockWithPin(
  pin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<AppLockVerifyResult> {
  if (unlockInFlight) {
    return unlockInFlight;
  }

  appLockTrace('UNLOCK_ATTEMPT');
  unlockInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      const record = await loadRecord(store);
      if (!record) {
        return { ok: false, reason: 'error' };
      }

      const validated = validatePinInput(pin);
      if (!validated.ok) {
        return { ok: false, reason: 'invalid_input' };
      }

      const policy = resolveAttemptPolicy({
        channel: 'pin',
        failedAttempts: record.pinFailedAttempts,
        now,
        retryAfter: record.pinRetryAfter,
      });
      if (policy.blocked) {
        appLockTrace('PIN_THROTTLED');
        return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
      }

      const result = await verifyPinAgainstRecord(validated.pin, record);
      if (result.ok) {
        await clearPinThrottle(store, record);
        appLockTrace('UNLOCK_SUCCEEDED');
        return { ok: true };
      }
      if (result.reason === 'error') {
        appLockTrace('UNLOCK_REJECTED');
        return result;
      }
      const updated = await recordPinFailure(store, record, now);
      appLockTrace('UNLOCK_REJECTED');
      return {
        ok: false,
        reason: 'mismatch',
        retryAfter: updated.pinRetryAfter,
      };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await unlockInFlight;
  } finally {
    unlockInFlight = null;
  }
}

/**
 * Re-authenticate with current PIN for sensitive unlocked actions (does not unlock).
 */
export async function authenticateCurrentPin(
  pin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<AppLockVerifyResult> {
  try {
    const record = await loadRecord(store);
    if (!record) {
      return { ok: false, reason: 'not_configured' };
    }
    const validated = validatePinInput(pin);
    if (!validated.ok) {
      return { ok: false, reason: 'invalid_input' };
    }
    const policy = resolveAttemptPolicy({
      channel: 'pin',
      failedAttempts: record.pinFailedAttempts,
      now,
      retryAfter: record.pinRetryAfter,
    });
    if (policy.blocked) {
      appLockTrace('PIN_THROTTLED');
      return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
    }
    const verified = await verifyPinAgainstRecord(validated.pin, record);
    if (!verified.ok) {
      if (verified.reason === 'mismatch') {
        const updated = await recordPinFailure(store, record, now);
        return {
          ok: false,
          reason: 'mismatch',
          retryAfter: updated.pinRetryAfter,
        };
      }
      return verified;
    }
    await clearPinThrottle(store, record);
    appLockTrace('CURRENT_PIN_VERIFIED');
    return { ok: true };
  } catch {
    appLockTrace('SECURE_STORAGE_ERROR');
    return { ok: false, reason: 'error' };
  }
}

/**
 * Change PIN: verify current, replace pin salt/verifier, preserve recovery.
 */
export async function changePin(
  currentPin: string,
  newPin: string,
  confirmNewPin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<AppLockVerifyResult> {
  if (changePinInFlight) {
    return changePinInFlight;
  }

  appLockTrace('CHANGE_PIN_STARTED');
  changePinInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      const record = await loadRecord(store);
      if (!record) {
        return { ok: false, reason: 'not_configured' };
      }

      const current = validatePinInput(currentPin);
      if (!current.ok) {
        return { ok: false, reason: 'invalid_input' };
      }
      const next = validatePinInput(newPin);
      const confirm = validatePinInput(confirmNewPin);
      if (!next.ok || !confirm.ok) {
        return { ok: false, reason: 'invalid_input' };
      }
      if (next.pin !== confirm.pin) {
        appLockTrace('CHANGE_PIN_REJECTED');
        return { ok: false, reason: 'mismatch' };
      }

      const policy = resolveAttemptPolicy({
        channel: 'pin',
        failedAttempts: record.pinFailedAttempts,
        now,
        retryAfter: record.pinRetryAfter,
      });
      if (policy.blocked) {
        appLockTrace('PIN_THROTTLED');
        return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
      }

      const verified = await verifyPinAgainstRecord(current.pin, record);
      if (!verified.ok) {
        if (verified.reason === 'mismatch') {
          const updated = await recordPinFailure(store, record, now);
          appLockTrace('CHANGE_PIN_REJECTED');
          return {
            ok: false,
            reason: 'mismatch',
            retryAfter: updated.pinRetryAfter,
          };
        }
        appLockTrace('CHANGE_PIN_REJECTED');
        return verified;
      }

      appLockTrace('CURRENT_PIN_VERIFIED');

      const pinSalt = await generateSaltHex();
      const pinVerifier = await derivePinVerifier(pinSalt, next.pin);
      const updated: AppLockCommittedRecord = {
        ...record,
        pinSalt,
        pinVerifier,
        pinVerifierVersion: APP_LOCK_VERIFIER_VERSION,
        pinFailedAttempts: 0,
        pinRetryAfter: null,
      };
      await persistRecord(store, updated);
      appLockTrace('CHANGE_PIN_COMMITTED');
      return { ok: true };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      appLockTrace('CHANGE_PIN_REJECTED');
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await changePinInFlight;
  } finally {
    changePinInFlight = null;
  }
}

/**
 * Verify recovery code while LOCKED. Grants permission to set a new PIN (does not unlock).
 */
export async function authenticateRecoveryCode(
  input: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<AppLockVerifyResult> {
  if (recoveryVerifyInFlight) {
    return recoveryVerifyInFlight;
  }

  appLockTrace('RECOVERY_STARTED');
  recoveryVerifyInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      const record = await loadRecord(store);
      if (!record) {
        return { ok: false, reason: 'not_configured' };
      }

      const trimmed = typeof input === 'string' ? input.trim() : '';
      if (!trimmed) {
        return { ok: false, reason: 'invalid_input' };
      }

      const policy = resolveAttemptPolicy({
        channel: 'recovery',
        failedAttempts: record.recoveryFailedAttempts,
        now,
        retryAfter: record.recoveryRetryAfter,
      });
      if (policy.blocked) {
        appLockTrace('RECOVERY_THROTTLED');
        return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
      }

      const result = await verifyRecoveryCode(trimmed, record);
      if (!result.ok) {
        if (result.reason === 'mismatch') {
          const updated = await recordRecoveryFailure(store, record, now);
          appLockTrace('RECOVERY_VERIFY_REJECTED');
          return {
            ok: false,
            reason: 'mismatch',
            retryAfter: updated.recoveryRetryAfter,
          };
        }
        appLockTrace('RECOVERY_VERIFY_REJECTED');
        return result;
      }

      recoveryAuthGranted = true;
      appLockTrace('RECOVERY_VERIFY_SUCCEEDED');
      return { ok: true };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      appLockTrace('RECOVERY_VERIFY_REJECTED');
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await recoveryVerifyInFlight;
  } finally {
    recoveryVerifyInFlight = null;
  }
}

/**
 * After recovery auth: set new PIN, preserve recovery verifier, clear throttles, unlock.
 */
export async function resetPinAfterRecovery(
  newPin: string,
  confirmNewPin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
): Promise<AppLockVerifyResult> {
  if (recoveryResetInFlight) {
    return recoveryResetInFlight;
  }

  recoveryResetInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      if (!recoveryAuthGranted) {
        return { ok: false, reason: 'not_configured' };
      }
      const record = await loadRecord(store);
      if (!record) {
        return { ok: false, reason: 'not_configured' };
      }

      const next = validatePinInput(newPin);
      const confirm = validatePinInput(confirmNewPin);
      if (!next.ok || !confirm.ok) {
        return { ok: false, reason: 'invalid_input' };
      }
      if (next.pin !== confirm.pin) {
        return { ok: false, reason: 'mismatch' };
      }

      const pinSalt = await generateSaltHex();
      const pinVerifier = await derivePinVerifier(pinSalt, next.pin);
      const updated: AppLockCommittedRecord = {
        ...record,
        pinSalt,
        pinVerifier,
        pinVerifierVersion: APP_LOCK_VERIFIER_VERSION,
        pinFailedAttempts: 0,
        pinRetryAfter: null,
        recoveryFailedAttempts: 0,
        recoveryRetryAfter: null,
      };
      await persistRecord(store, updated);
      recoveryAuthGranted = false;
      appLockTrace('RECOVERY_PIN_RESET_COMMITTED');
      return { ok: true };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      // Remain locked; recovery auth may still be granted for retry.
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await recoveryResetInFlight;
  } finally {
    recoveryResetInFlight = null;
  }
}

/**
 * Start recovery rotation: require current PIN, generate new code in memory.
 * Old recovery remains valid until commit.
 */
export async function beginRecoveryRotation(
  currentPin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<
  | { ok: true; session: AppLockRecoveryRotationSession }
  | { ok: false; reason: AppLockVerifyFailureReason; retryAfter?: number | null }
> {
  appLockTrace('RECOVERY_ROTATION_STARTED');
  try {
    const record = await loadRecord(store);
    if (!record) {
      return { ok: false, reason: 'not_configured' };
    }

    const current = validatePinInput(currentPin);
    if (!current.ok) {
      return { ok: false, reason: 'invalid_input' };
    }

    const policy = resolveAttemptPolicy({
      channel: 'pin',
      failedAttempts: record.pinFailedAttempts,
      now,
      retryAfter: record.pinRetryAfter,
    });
    if (policy.blocked) {
      appLockTrace('PIN_THROTTLED');
      return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
    }

    const verified = await verifyPinAgainstRecord(current.pin, record);
    if (!verified.ok) {
      if (verified.reason === 'mismatch') {
        const updated = await recordPinFailure(store, record, now);
        return {
          ok: false,
          reason: 'mismatch',
          retryAfter: updated.pinRetryAfter,
        };
      }
      return { ok: false, reason: verified.reason };
    }

    await clearPinThrottle(store, record);

    const recoverySalt = await generateSaltHex();
    const recoveryCodePlaintext = await generateRecoveryCode();
    const recoveryVerifier = await deriveRecoveryVerifier(
      recoverySalt,
      recoveryCodePlaintext,
    );
    const session: AppLockRecoveryRotationSession = {
      recoverySalt,
      recoveryVerifier,
      recoveryCodePlaintext,
    };
    activeRecoveryRotation = session;
    return { ok: true, session };
  } catch {
    appLockTrace('SECURE_STORAGE_ERROR');
    return { ok: false, reason: 'error' };
  }
}

export async function commitRecoveryRotation(
  acknowledged: boolean,
  store: SecureStoreLike = getDefaultSecureStore(),
): Promise<AppLockVerifyResult> {
  if (!acknowledged) {
    return { ok: false, reason: 'invalid_input' };
  }
  if (!activeRecoveryRotation) {
    return { ok: false, reason: 'not_configured' };
  }
  if (recoveryRotationInFlight) {
    return recoveryRotationInFlight;
  }

  const session = activeRecoveryRotation;
  recoveryRotationInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      const record = await loadRecord(store);
      if (!record) {
        return { ok: false, reason: 'not_configured' };
      }
      const updated: AppLockCommittedRecord = {
        ...record,
        recoverySalt: session.recoverySalt,
        recoveryVerifier: session.recoveryVerifier,
        recoveryVerifierVersion: APP_LOCK_VERIFIER_VERSION,
      };
      await persistRecord(store, updated);
      activeRecoveryRotation = null;
      appLockTrace('RECOVERY_ROTATION_COMMITTED');
      return { ok: true };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await recoveryRotationInFlight;
  } finally {
    recoveryRotationInFlight = null;
  }
}

/**
 * Disable requires current PIN verification, then deletes the SecureStore record.
 * Does not set DISABLED before successful delete.
 */
export async function disableWithPin(
  pin: string,
  store: SecureStoreLike = getDefaultSecureStore(),
  now: number = Date.now(),
): Promise<AppLockVerifyResult> {
  if (disableInFlight) {
    return disableInFlight;
  }

  appLockTrace('DISABLE_STARTED');
  disableInFlight = (async (): Promise<AppLockVerifyResult> => {
    try {
      const record = await loadRecord(store);
      if (!record) {
        appLockTrace('DISABLE_REJECTED');
        return { ok: false, reason: 'not_configured' };
      }

      const validated = validatePinInput(pin);
      if (!validated.ok) {
        return { ok: false, reason: 'invalid_input' };
      }

      const policy = resolveAttemptPolicy({
        channel: 'pin',
        failedAttempts: record.pinFailedAttempts,
        now,
        retryAfter: record.pinRetryAfter,
      });
      if (policy.blocked) {
        return { ok: false, reason: 'throttled', retryAfter: policy.retryAfter };
      }

      const verified = await verifyPinAgainstRecord(validated.pin, record);
      if (!verified.ok) {
        if (verified.reason === 'mismatch') {
          await recordPinFailure(store, record, now);
        }
        appLockTrace('DISABLE_REJECTED');
        return verified.reason === 'mismatch'
          ? { ok: false, reason: 'mismatch' }
          : verified;
      }

      await deleteAppLockRecord(store);
      cachedRecord = null;
      clearSensitiveEphemeralState();
      appLockTrace('DISABLE_COMMITTED');
      return { ok: true };
    } catch {
      appLockTrace('SECURE_STORAGE_ERROR');
      appLockTrace('DISABLE_REJECTED');
      return { ok: false, reason: 'error' };
    }
  })();

  try {
    return await disableInFlight;
  } finally {
    disableInFlight = null;
  }
}

export function getPinThrottleSnapshot(
  now: number = Date.now(),
): { blocked: boolean; retryAfter: number | null } {
  const record = cachedRecord;
  if (!record) {
    return { blocked: false, retryAfter: null };
  }
  const policy = resolveAttemptPolicy({
    channel: 'pin',
    failedAttempts: record.pinFailedAttempts,
    now,
    retryAfter: record.pinRetryAfter,
  });
  return { blocked: policy.blocked, retryAfter: policy.retryAfter };
}

export function getRecoveryThrottleSnapshot(
  now: number = Date.now(),
): { blocked: boolean; retryAfter: number | null } {
  const record = cachedRecord;
  if (!record) {
    return { blocked: false, retryAfter: null };
  }
  const policy = resolveAttemptPolicy({
    channel: 'recovery',
    failedAttempts: record.recoveryFailedAttempts,
    now,
    retryAfter: record.recoveryRetryAfter,
  });
  return { blocked: policy.blocked, retryAfter: policy.retryAfter };
}

export function resetAppLockServiceForTests(): void {
  activeSetup = null;
  activeRecoveryRotation = null;
  recoveryAuthGranted = false;
  cachedRecord = null;
  setupInFlight = null;
  commitInFlight = null;
  unlockInFlight = null;
  disableInFlight = null;
  changePinInFlight = null;
  recoveryVerifyInFlight = null;
  recoveryResetInFlight = null;
  recoveryRotationInFlight = null;
}
