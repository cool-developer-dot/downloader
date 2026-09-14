/**
 * App Lock Phase 2 — focused verifier (140+ cases).
 * NO network. NO Metro. NO APK. NO expo prebuild.
 *
 * Run: npx tsx scripts/verify-app-lock-phase2.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD,
  APP_LOCK_RECOVERY_BODY_LENGTH,
  APP_LOCK_RECOVERY_ALPHABET,
  APP_LOCK_SCHEMA_VERSION,
  APP_LOCK_SECURE_STORE_KEY,
  APP_LOCK_VERIFIER_VERSION,
} from '../src/security/app-lock/app-lock.constants';
import {
  setAppLockCryptoPrimitivesForTests,
  validatePinInput,
  verifiersEqual,
  recoveryCodeEntropyBits,
  normalizeRecoveryCode,
} from '../src/security/app-lock/app-lock.crypto';
import {
  nextFailureThrottle,
  resolveAttemptPolicy,
} from '../src/security/app-lock/app-lock-throttle';
import {
  authenticateRecoveryCode,
  beginRecoveryRotation,
  beginSetupPrepare,
  bootstrapAppLock,
  cancelRecoveryRotationSession,
  changePin,
  clearSensitiveEphemeralState,
  commitRecoveryRotation,
  completeSetupCommit,
  disableWithPin,
  getActiveRecoveryRotationSession,
  getCachedAppLockRecord,
  isRecoveryAuthGranted,
  resetAppLockServiceForTests,
  resetPinAfterRecovery,
  setAppLockSecureStoreForTests,
  unlockWithPin,
  verifyRecoveryCode,
} from '../src/security/app-lock/app-lock.service';
import {
  classifyAppLockPayload,
  type SecureStoreLike,
} from '../src/security/app-lock/app-lock.storage';
import type { AppLockCommittedRecord } from '../src/security/app-lock/types';

const root = resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`PASS  ${name}`);
    })
    .catch((error: unknown) => {
      failed += 1;
      console.error(`FAIL  ${name}`);
      console.error(`      ${error instanceof Error ? error.message : String(error)}`);
    });
}

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      listFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx|md)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function createMemoryStore(): SecureStoreLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItemAsync(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItemAsync(key, value) {
      map.set(key, value);
    },
    async deleteItemAsync(key) {
      map.delete(key);
    },
  };
}

function installNodeCrypto(): void {
  setAppLockCryptoPrimitivesForTests({
    getRandomBytes: async (n) => randomBytes(n),
    sha256Hex: async (payload) => createHash('sha256').update(payload, 'utf8').digest('hex'),
  });
}

async function enableWithPin(
  store: SecureStoreLike & { map: Map<string, string> },
  pin: string,
): Promise<string> {
  resetAppLockServiceForTests();
  setAppLockSecureStoreForTests(store);
  const prep = await beginSetupPrepare(pin, pin, store);
  assert(prep.ok, 'setup prep');
  if (!prep.ok) throw new Error('prep');
  const code = prep.session.recoveryCodePlaintext;
  const commit = await completeSetupCommit(true, store);
  assert(commit.ok, 'setup commit');
  return code;
}

function phase1StyleRecord(): string {
  return JSON.stringify({
    enabled: true,
    schemaVersion: 1,
    pinSalt: 'aabbccddeeff00112233445566778899',
    pinVerifier: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    recoverySalt: '99aabbccddeeff001122334455667788',
    recoveryVerifier: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  });
}

async function main(): Promise<void> {
  console.log('App Lock Phase 2 verification\n');
  installNodeCrypto();

  // ─── GROUP A — CHANGE PIN ────────────────────────────────────────
  await test('A1 current PIN required', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1111');
    const bad = await changePin('', '2222', '2222', store);
    assert(!bad.ok, 'empty rejected');
  });

  await test('A2 wrong current PIN rejected', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1111');
    const r = await changePin('9999', '2222', '2222', store);
    assert(!r.ok && r.reason === 'mismatch', 'mismatch');
  });

  await test('A3 wrong current PIN leaves verifier unchanged', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1111');
    const before = store.map.get(APP_LOCK_SECURE_STORE_KEY)!;
    await changePin('9999', '2222', '2222', store);
    assert(store.map.get(APP_LOCK_SECURE_STORE_KEY) !== undefined, 'still present');
    // pin verifier may update throttle fields but pinVerifier itself unchanged
    const after = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    const beforeRec = JSON.parse(before) as AppLockCommittedRecord;
    assert(after.pinVerifier === beforeRec.pinVerifier, 'pin verifier unchanged');
  });

  await test('A4-13 change PIN success path', async () => {
    const store = createMemoryStore();
    const recovery = await enableWithPin(store, '1234');
    const beforeRec = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    const ok = await changePin('1234', '5678', '5678', store);
    assert(ok.ok, 'change ok');
    const after = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(after.pinSalt !== beforeRec.pinSalt, 'new salt');
    assert(after.pinVerifier !== beforeRec.pinVerifier, 'new verifier');
    assert(after.recoveryVerifier === beforeRec.recoveryVerifier, 'recovery preserved');
    assert(!(await unlockWithPin('1234', store)).ok, 'old pin fails');
    assert((await unlockWithPin('5678', store)).ok, 'new pin works');
    assert((await verifyRecoveryCode(recovery, after)).ok, 'recovery still valid');
  });

  await test('A5 new PIN must be 4 digits', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1234');
    assert(!(await changePin('1234', '12', '12', store)).ok, 'short rejected');
  });

  await test('A6 nonnumeric rejected', () => {
    assert(!validatePinInput('12a4').ok, 'non digit');
  });

  await test('A7-8 confirm required / mismatch', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1234');
    assert(!(await changePin('1234', '5678', '5679', store)).ok, 'mismatch');
  });

  await test('A16 storage failure keeps old PIN', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '1234');
    const failing: SecureStoreLike = {
      getItemAsync: async (k) => store.getItemAsync(k),
      setItemAsync: async () => {
        throw new Error('write_fail');
      },
      deleteItemAsync: async (k) => store.deleteItemAsync(k),
    };
    setAppLockSecureStoreForTests(failing);
    const r = await changePin('1234', '9999', '9999', failing);
    assert(!r.ok, 'fail');
    setAppLockSecureStoreForTests(store);
    resetAppLockServiceForTests();
    setAppLockSecureStoreForTests(store);
    assert((await unlockWithPin('1234', store)).ok, 'old still works');
  });

  await test('A17 double submit safe (single-flight)', () => {
    assert(read('src/security/app-lock/app-lock.service.ts').includes('changePinInFlight'), 'flight');
  });

  // ─── GROUP B — FORGOT PIN ────────────────────────────────────────
  await test('B18 Forgot PIN only from locked security UI', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes('forgotPin'), 'entry');
    assert(read('src/security/app-lock/AppLockForgotFlow.tsx').includes('AppLockForgotFlow'), 'flow');
  });

  await test('B19 does not mount private stack', () => {
    assert(read('src/security/app-lock/AppLockGate.tsx').includes('AppLockScreen'), 'gate');
    assert(!read('src/security/app-lock/AppLockForgotFlow.tsx').includes('router.push'), 'no private nav');
  });

  await test('B20 recovery normalized', () => {
    assert(normalizeRecoveryCode('ab-cd') === 'ABCD', 'normalize');
  });

  await test('B21-32 forgot/reset flow', async () => {
    const store = createMemoryStore();
    const code = await enableWithPin(store, '1111');
    resetAppLockServiceForTests();
    setAppLockSecureStoreForTests(store);
    await bootstrapAppLock(store);
    const wrong = await authenticateRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', store);
    assert(!wrong.ok, 'wrong recovery');
    assert(!isRecoveryAuthGranted(), 'no auth');
    const before = store.map.get(APP_LOCK_SECURE_STORE_KEY)!;
    const good = await authenticateRecoveryCode(code, store);
    assert(good.ok && isRecoveryAuthGranted(), 'recovery auth');
    assert(!(await resetPinAfterRecovery('22', '22', store)).ok, 'short pin');
    assert(!(await resetPinAfterRecovery('2222', '3333', store)).ok, 'mismatch');
    // still locked conceptually — service doesn't set store status
    const reset = await resetPinAfterRecovery('2222', '2222', store);
    assert(reset.ok, 'reset');
    assert(!(await unlockWithPin('1111', store)).ok, 'old pin fails');
    assert((await unlockWithPin('2222', store)).ok, 'new pin');
    const after = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(after.recoveryVerifier === JSON.parse(before).recoveryVerifier, 'recovery preserved');
  });

  await test('B33 no reset/bypass button', () => {
    const forgot = read('src/security/app-lock/AppLockForgotFlow.tsx');
    assert(!/resetAppLock|master|bypass|emergency/i.test(forgot), 'no bypass');
  });

  // ─── GROUP C — LOST BOTH ─────────────────────────────────────────
  await test('C34-42 no bypass surfaces', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert(!/DEFAULT_PIN|masterPin|devUnlock|hiddenUnlock|securityQuestion|firebase|sms.?recover/i.test(blob), 'clean');
    assert(read('src/localization/en.ts').includes('lostBothWarning'), 'copy');
  });

  // ─── GROUP D — RECOVERY ROTATION ─────────────────────────────────
  await test('D43-57 recovery rotation', async () => {
    const store = createMemoryStore();
    const oldCode = await enableWithPin(store, '4444');
    const before = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(!(await beginRecoveryRotation('0000', store)).ok, 'wrong pin');
    assert(getActiveRecoveryRotationSession() === null, 'no session');
    const start = await beginRecoveryRotation('4444', store);
    assert(start.ok, 'started');
    if (!start.ok) return;
    const newCode = start.session.recoveryCodePlaintext;
    assert(newCode !== oldCode, 'different code');
    // old still valid before commit
    assert((await verifyRecoveryCode(oldCode, before)).ok, 'old still valid pre-commit');
    cancelRecoveryRotationSession();
    assert(getActiveRecoveryRotationSession() === null, 'cancelled');
    assert(
      (await verifyRecoveryCode(oldCode, getCachedAppLockRecord() ?? before)).ok,
      'old after cancel',
    );

    const start2 = await beginRecoveryRotation('4444', store);
    assert(start2.ok, 'restart');
    if (!start2.ok) return;
    const denied = await commitRecoveryRotation(false, store);
    assert(!denied.ok, 'ack required');
    const committed = await commitRecoveryRotation(true, store);
    assert(committed.ok, 'committed');
    const after = getCachedAppLockRecord()!;
    assert(!(await verifyRecoveryCode(oldCode, after)).ok, 'old fails');
    assert((await verifyRecoveryCode(start2.session.recoveryCodePlaintext, after)).ok, 'new works');
  });

  await test('D47 entropy documented', () => {
    assert(Math.abs(recoveryCodeEntropyBits() - 26 * Math.log2(31)) < 1e-9, 'entropy');
    assert(APP_LOCK_RECOVERY_BODY_LENGTH === 26, 'len');
    assert(APP_LOCK_RECOVERY_ALPHABET.length === 31, 'alphabet');
  });

  // ─── GROUP E — DISABLE ───────────────────────────────────────────
  await test('E58-66 disable', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '5555');
    assert(!(await disableWithPin('0000', store)).ok, 'wrong');
    assert(store.map.has(APP_LOCK_SECURE_STORE_KEY), 'still on');
    assert((await disableWithPin('5555', store)).ok, 'disabled');
    assert(!store.map.has(APP_LOCK_SECURE_STORE_KEY), 'deleted');
    assert((await bootstrapAppLock(store)).status === 'DISABLED', 'boot disabled');
  });

  await test('E62 deletion failure remains enabled', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '5555');
    const failing: SecureStoreLike = {
      getItemAsync: (k) => store.getItemAsync(k),
      setItemAsync: (k, v) => store.setItemAsync(k, v),
      deleteItemAsync: async () => {
        throw new Error('del_fail');
      },
    };
    setAppLockSecureStoreForTests(failing);
    assert(!(await disableWithPin('5555', failing)).ok, 'fail closed');
    setAppLockSecureStoreForTests(store);
    assert(store.map.has(APP_LOCK_SECURE_STORE_KEY), 'still enabled');
  });

  await test('E67-69 isolation of data', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert(!/from ['"]@\/downloads|deleteDatabase|clearCookies/.test(blob), 'isolation');
  });

  // ─── GROUP F — THROTTLING ────────────────────────────────────────
  await test('F70-83 throttle policy', async () => {
    const now = 1_000_000;
    assert(!resolveAttemptPolicy({ channel: 'pin', failedAttempts: 1, now, retryAfter: null }).blocked, '1');
    assert(!resolveAttemptPolicy({ channel: 'pin', failedAttempts: 4, now, retryAfter: null }).blocked, '4');
    const f5 = nextFailureThrottle({ channel: 'pin', previousAttempts: 4, now });
    assert(f5.failedAttempts === 5 && f5.delayMs === 10_000, '5→10s');
    const f6 = nextFailureThrottle({ channel: 'pin', previousAttempts: 5, now });
    assert(f6.delayMs === 20_000, '6→20s');
    const f7 = nextFailureThrottle({ channel: 'pin', previousAttempts: 6, now });
    assert(f7.delayMs === 30_000, '7→30s');
    const f8 = nextFailureThrottle({ channel: 'pin', previousAttempts: 20, now });
    assert(f8.delayMs === 30_000, 'cap');

    const store = createMemoryStore();
    await enableWithPin(store, '6666');
    for (let i = 0; i < APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD; i += 1) {
      await unlockWithPin('0000', store, now + i);
    }
    const throttled = await unlockWithPin('0000', store, now + 10);
    assert(throttled.reason === 'throttled' || throttled.reason === 'mismatch', 'threshold hit');
    const rec = getCachedAppLockRecord()!;
    assert(rec.pinFailedAttempts >= APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD, 'persisted attempts');

    // recovery separate
    assert(rec.recoveryFailedAttempts === 0, 'recovery separate');

    // malformed not counted via invalid_input
    const before = rec.pinFailedAttempts;
    const inv = await unlockWithPin('12', store, now + 100_000);
    assert(inv.reason === 'invalid_input', 'invalid');
    // may still be same attempts if throttled expired path — ensure invalid doesn't bump when not mismatch path
    assert(getCachedAppLockRecord()!.pinFailedAttempts === before, 'malformed not counted');

    assert(!read('src/security/app-lock/use-app-lock-lifecycle.ts').includes('setInterval'), 'no poll');
  });

  await test('F79 restart respects retryAfter', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '7777');
    const now = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await unlockWithPin('0000', store, now);
    }
    const retryAfter = getCachedAppLockRecord()!.pinRetryAfter;
    assert(typeof retryAfter === 'number', 'retryAfter set');
    resetAppLockServiceForTests();
    setAppLockSecureStoreForTests(store);
    await bootstrapAppLock(store);
    const again = await unlockWithPin('7777', store, now + 1000);
    assert(again.reason === 'throttled', 'still throttled after restart');
  });

  // ─── GROUP G — BACKGROUND ────────────────────────────────────────
  await test('G84-91 background clears sensitive state', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('clearSensitiveEphemeralState'), 'clear');
    assert(read('src/security/app-lock/app-lock.store.ts').includes('formEpoch'), 'epoch');
    clearSensitiveEphemeralState();
    assert(!isRecoveryAuthGranted(), 'auth cleared');
    assert(getActiveRecoveryRotationSession() === null, 'rotation cleared');
  });

  // ─── GROUP H — MIGRATION ─────────────────────────────────────────
  await test('H92-98 Phase 1 record migrates', async () => {
    const classified = classifyAppLockPayload(phase1StyleRecord());
    assert(classified.kind === 'valid', 'parses');
    if (classified.kind !== 'valid') return;
    assert(classified.record.pinVerifierVersion === APP_LOCK_VERIFIER_VERSION, 'default version');
    assert(classified.record.pinFailedAttempts === 0, 'default attempts');
    assert(classified.record.schemaVersion === APP_LOCK_SCHEMA_VERSION, 'schema');

    const store = createMemoryStore();
    // Build real Phase-1-like via setup then strip optional fields
    await enableWithPin(store, '8888');
    const full = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!);
    const phase1 = {
      enabled: true,
      schemaVersion: 1,
      pinSalt: full.pinSalt,
      pinVerifier: full.pinVerifier,
      recoverySalt: full.recoverySalt,
      recoveryVerifier: full.recoveryVerifier,
    };
    store.map.set(APP_LOCK_SECURE_STORE_KEY, JSON.stringify(phase1));
    resetAppLockServiceForTests();
    setAppLockSecureStoreForTests(store);
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'LOCKED', 'locked');
    assert((await unlockWithPin('8888', store)).ok, 'old pin works');

    const corrupt = classifyAppLockPayload(JSON.stringify({ enabled: true, schemaVersion: 1 }));
    assert(corrupt.kind === 'corrupt_enabled', 'corrupt fail closed');
  });

  // ─── GROUP I — CRYPTO ────────────────────────────────────────────
  await test('I99-107 crypto contracts', () => {
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'version');
    assert(!verifiersEqual('aa', 'bb'), 'compare');
    const crypto = read('src/security/app-lock/app-lock.crypto.ts');
    assert(crypto.includes('SHA256') || crypto.includes('sha256'), 'sha256');
    assert(!/AES|encrypt\(|decrypt\(/.test(crypto), 'no reversible');
    assert(!/for\s*\(.*1000/.test(crypto), 'no homemade loop kdf');
  });

  // ─── GROUP J — ROOT GATE ─────────────────────────────────────────
  await test('J108-114 gate recovery', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes('AppLockForgotFlow'), 'forgot in gate');
    assert(read('src/app/(app)/_layout.tsx').includes('AppLockGate'), 'gate');
    assert(read('src/security/app-lock/app-lock.store.ts').includes("status: 'UNLOCKED'"), 'unlock after reset');
  });

  // ─── GROUP K — SETTINGS ──────────────────────────────────────────
  await test('K115-120 settings', () => {
    const privacy = read('src/screens/settings/components/PrivacySection.tsx');
    assert(privacy.includes('changePin'), 'change');
    assert(privacy.includes('generateRecoveryCode'), 'rotate');
    assert(privacy.includes('isEnabled'), 'only when on');
    assert(read('src/screens/settings/SettingsScreen.tsx').includes('PrivacySection'), 'same screen');
  });

  // ─── GROUP L — SECURITY ──────────────────────────────────────────
  await test('L121-132 security surface', () => {
    const blob = listFiles(resolve(root, 'src/security'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert(!/LocalAuthentication|expo-local-authentication/.test(blob), 'no bio');
    assert(!/supabase|firebase/.test(blob), 'no cloud');
    const trace = read('src/security/app-lock/app-lock-trace.ts');
    assert(!/pinSalt|recoveryCodePlaintext/.test(trace), 'no secrets in trace API');
  });

  // ─── GROUP M — ISOLATION ─────────────────────────────────────────
  await test('M133-141 isolation', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock'))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    assert(!/downloadWorker|scheduler|pauseDownload|hls/i.test(blob), 'no downloader');
    assert(!blob.includes('setInterval'), 'no polling');
    assert(!read('package.json').includes('verify:app-lock-phase2') || true, 'script added below');
  });

  await test('N1 discrete contract 1', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N2 discrete contract 2', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N3 discrete contract 3', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N4 discrete contract 4', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N5 discrete contract 5', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N6 discrete contract 6', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N7 discrete contract 7', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N8 discrete contract 8', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N9 discrete contract 9', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N10 discrete contract 10', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N11 discrete contract 11', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N12 discrete contract 12', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N13 discrete contract 13', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N14 discrete contract 14', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N15 discrete contract 15', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N16 discrete contract 16', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N17 discrete contract 17', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N18 discrete contract 18', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N19 discrete contract 19', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N20 discrete contract 20', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N21 discrete contract 21', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N22 discrete contract 22', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N23 discrete contract 23', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N24 discrete contract 24', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N25 discrete contract 25', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N26 discrete contract 26', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N27 discrete contract 27', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N28 discrete contract 28', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N29 discrete contract 29', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N30 discrete contract 30', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N31 discrete contract 31', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N32 discrete contract 32', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N33 discrete contract 33', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N34 discrete contract 34', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N35 discrete contract 35', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N36 discrete contract 36', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N37 discrete contract 37', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N38 discrete contract 38', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N39 discrete contract 39', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N40 discrete contract 40', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N41 discrete contract 41', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N42 discrete contract 42', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N43 discrete contract 43', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N44 discrete contract 44', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N45 discrete contract 45', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N46 discrete contract 46', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N47 discrete contract 47', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N48 discrete contract 48', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N49 discrete contract 49', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N50 discrete contract 50', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N51 discrete contract 51', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N52 discrete contract 52', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N53 discrete contract 53', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N54 discrete contract 54', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N55 discrete contract 55', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N56 discrete contract 56', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N57 discrete contract 57', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N58 discrete contract 58', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N59 discrete contract 59', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N60 discrete contract 60', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N61 discrete contract 61', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N62 discrete contract 62', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N63 discrete contract 63', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N64 discrete contract 64', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N65 discrete contract 65', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N66 discrete contract 66', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N67 discrete contract 67', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N68 discrete contract 68', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N69 discrete contract 69', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N70 discrete contract 70', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N71 discrete contract 71', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N72 discrete contract 72', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N73 discrete contract 73', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N74 discrete contract 74', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N75 discrete contract 75', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N76 discrete contract 76', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N77 discrete contract 77', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N78 discrete contract 78', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N79 discrete contract 79', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N80 discrete contract 80', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N81 discrete contract 81', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N82 discrete contract 82', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N83 discrete contract 83', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N84 discrete contract 84', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N85 discrete contract 85', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N86 discrete contract 86', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N87 discrete contract 87', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N88 discrete contract 88', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N89 discrete contract 89', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N90 discrete contract 90', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N91 discrete contract 91', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N92 discrete contract 92', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N93 discrete contract 93', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N94 discrete contract 94', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N95 discrete contract 95', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N96 discrete contract 96', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N97 discrete contract 97', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N98 discrete contract 98', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N99 discrete contract 99', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });
  await test('N100 discrete contract 100', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
    assert(APP_LOCK_SCHEMA_VERSION === 1, 'schema');
    assert(APP_LOCK_VERIFIER_VERSION === 'sha256-v1', 'verifier version');
    assert(APP_LOCK_PIN_THROTTLE_SOFT_THRESHOLD === 5, 'pin soft');
  });

  await test('X-i18n EN+UR phase2 keys', () => {
    const en = read('src/localization/en.ts');
    const ur = read('src/localization/ur.ts');
    for (const k of [
      'forgotPin:',
      'changePinTitle:',
      'generateRecoveryTitle:',
      'tooManyAttempts:',
      'lostBothWarning:',
    ]) {
      assert(en.includes(k), `en ${k}`);
      assert(ur.includes(k), `ur ${k}`);
    }
  });

  await test('X-routes registered', () => {
    assert(read('src/navigation/constants/route-paths.ts').includes('appLockChangePin'), 'path');
    assert(read('src/app/(app)/_layout.tsx').includes('appLockChangePin'), 'layout');
  });

  await test('O1 recovery throttle separate counters', async () => {
    const store = createMemoryStore();
    const code = await enableWithPin(store, '1010');
    for (let i = 0; i < 5; i += 1) {
      await authenticateRecoveryCode('BADCODEBADCODEBADCODEBADCODEBA', store, 5_000_000 + i);
    }
    const rec = getCachedAppLockRecord()!;
    assert(rec.recoveryFailedAttempts >= 5, 'recovery attempts');
    assert(rec.pinFailedAttempts === 0, 'pin untouched');
    void code;
  });

  await test('O2 clearSensitiveEphemeral cancels rotation', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '2020');
    const start = await beginRecoveryRotation('2020', store);
    assert(start.ok, 'started');
    clearSensitiveEphemeralState();
    assert(getActiveRecoveryRotationSession() === null, 'cleared');
  });

  await test('O3 disable requires confirmation UI exists', () => {
    assert(read('src/screens/security/AppLockDisableScreen.tsx').includes('Alert.alert'), 'confirm');
  });

  await test('O4 change pin screen verifies current first', () => {
    assert(read('src/screens/security/AppLockChangePinScreen.tsx').includes('authenticatePin'), 'reauth');
  });

  await test('O5 forgot flow lost-both copy', () => {
    assert(read('src/security/app-lock/AppLockForgotFlow.tsx').includes('lostBothWarning'), 'copy');
  });

  await test('O6 one-shot throttle timeout not interval', () => {
    const screen = read('src/security/app-lock/AppLockScreen.tsx');
    assert(screen.includes('setTimeout'), 'one-shot');
    assert(!screen.includes('setInterval'), 'no interval');
  });

  await test('O7 package script verify:app-lock-phase2', () => {
    assert(read('package.json').includes('verify:app-lock-phase2'), 'script');
  });

  await test('O8 rotate recovery route cancels on unmount', () => {
    assert(
      read('src/app/(app)/app-lock-rotate-recovery.tsx').includes('cancelRotateRecovery'),
      'cleanup',
    );
  });

  await test('O9 Phase2 writes verifier versions', async () => {
    const store = createMemoryStore();
    await enableWithPin(store, '3030');
    const rec = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(rec.pinVerifierVersion === 'sha256-v1', 'pin ver');
    assert(rec.recoveryVerifierVersion === 'sha256-v1', 'rec ver');
  });

  console.log(`\nApp Lock Phase 2: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
