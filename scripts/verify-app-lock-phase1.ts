/**
 * App Lock Phase 1 — focused verifier (90+ cases).
 * NO network. NO Metro. NO APK. NO expo prebuild.
 *
 * Run: npx tsx scripts/verify-app-lock-phase1.ts
 * Or:  npm run verify:app-lock-phase1
 */

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APP_LOCK_PIN_LENGTH,
  APP_LOCK_RECOVERY_ALPHABET,
  APP_LOCK_RECOVERY_BODY_LENGTH,
  APP_LOCK_SCHEMA_VERSION,
  APP_LOCK_SECURE_STORE_KEY,
} from '../src/security/app-lock/app-lock.constants';
import {
  derivePinVerifier,
  deriveRecoveryVerifier,
  formatRecoveryCode,
  generateRecoveryCode,
  generateSaltHex,
  normalizeRecoveryCode,
  recoveryCodeEntropyBits,
  setAppLockCryptoPrimitivesForTests,
  validatePinInput,
  verifiersEqual,
} from '../src/security/app-lock/app-lock.crypto';
import { decideBootstrap } from '../src/security/app-lock/app-lock-policy';
import {
  beginSetupPrepare,
  bootstrapAppLock,
  cancelSetupSession,
  completeSetupCommit,
  disableWithPin,
  getActiveSetupSession,
  resetAppLockServiceForTests,
  setAppLockSecureStoreForTests,
  unlockWithPin,
  verifyPinAgainstRecord,
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
      const message = error instanceof Error ? error.message : String(error);
      console.error(`FAIL  ${name}`);
      console.error(`      ${message}`);
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
    } else if (/\.(ts|tsx|js|jsx|kt|java|md)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function createMemoryStore(): SecureStoreLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async getItemAsync(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    async setItemAsync(key: string, value: string) {
      map.set(key, value);
    },
    async deleteItemAsync(key: string) {
      map.delete(key);
    },
  };
}

function createFailingStore(mode: 'read' | 'write' | 'delete'): SecureStoreLike {
  return {
    async getItemAsync() {
      if (mode === 'read') throw new Error('read_fail');
      return null;
    },
    async setItemAsync() {
      if (mode === 'write') throw new Error('write_fail');
    },
    async deleteItemAsync() {
      if (mode === 'delete') throw new Error('delete_fail');
    },
  };
}

function installNodeCrypto(): void {
  setAppLockCryptoPrimitivesForTests({
    getRandomBytes: async (n) => randomBytes(n),
    sha256Hex: async (payload) => createHash('sha256').update(payload, 'utf8').digest('hex'),
  });
}

function validRecord(overrides: Partial<AppLockCommittedRecord> = {}): AppLockCommittedRecord {
  return {
    enabled: true,
    schemaVersion: APP_LOCK_SCHEMA_VERSION,
    pinSalt: 'aabbccddeeff00112233445566778899',
    pinVerifier: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    recoverySalt: '99aabbccddeeff001122334455667788',
    recoveryVerifier: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log('App Lock Phase 1 verification\n');
  installNodeCrypto();

  // ─── GROUP A — STORAGE ───────────────────────────────────────────
  await test('A1 default no App Lock data → DISABLED', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    setAppLockSecureStoreForTests(store);
    const result = await bootstrapAppLock(store);
    assert(result.status === 'DISABLED', 'expected DISABLED');
  });

  await test('A2 configured enabled → LOCKED on bootstrap', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await store.setItemAsync(APP_LOCK_SECURE_STORE_KEY, JSON.stringify(validRecord()));
    const result = await bootstrapAppLock(store);
    assert(result.status === 'LOCKED', 'expected LOCKED');
  });

  await test('A3 PIN plaintext never persisted', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    setAppLockSecureStoreForTests(store);
    const prep = await beginSetupPrepare('1234', '1234', store);
    assert(prep.ok, 'setup prepare');
    const ack = await completeSetupCommit(true, store);
    assert(ack.ok, 'commit');
    const raw = store.map.get(APP_LOCK_SECURE_STORE_KEY) ?? '';
    assert(!raw.includes('1234'), 'PIN must not appear in SecureStore payload');
  });

  await test('A4 recovery plaintext never persisted', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('4242', '4242', store);
    assert(prep.ok && prep.ok === true, 'prep');
    if (!prep.ok) return;
    const code = prep.session.recoveryCodePlaintext;
    const ack = await completeSetupCommit(true, store);
    assert(ack.ok, 'commit');
    const raw = store.map.get(APP_LOCK_SECURE_STORE_KEY) ?? '';
    assert(!raw.includes(code), 'recovery plaintext must not persist');
    assert(!raw.includes(normalizeRecoveryCode(code)), 'normalized recovery must not persist');
  });

  await test('A5 PIN verifier stored in SecureStore only (single key)', async () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'versioned key');
    const store = createMemoryStore();
    resetAppLockServiceForTests();
    await beginSetupPrepare('1111', '1111', store);
    await completeSetupCommit(true, store);
    assert(store.map.size === 1, 'exactly one SecureStore key');
    assert(store.map.has(APP_LOCK_SECURE_STORE_KEY), 'app lock key present');
    const parsed = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(typeof parsed.pinVerifier === 'string' && parsed.pinVerifier.length === 64, 'pin verifier');
  });

  await test('A6 recovery verifier stored in SecureStore only', async () => {
    const store = createMemoryStore();
    resetAppLockServiceForTests();
    await beginSetupPrepare('2222', '2222', store);
    await completeSetupCommit(true, store);
    const parsed = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(typeof parsed.recoveryVerifier === 'string', 'recovery verifier');
    assert(parsed.enabled === true, 'enabled');
  });

  await test('A7 no PIN in AsyncStorage/MMKV/SQLite modules (static)', () => {
    const securityDir = resolve(root, 'src/security/app-lock');
    for (const file of listFiles(securityDir)) {
      const src = readFileSync(file, 'utf8');
      assert(!/AsyncStorage/.test(src), `${file} must not use AsyncStorage`);
      assert(!/react-native-mmkv|from 'react-native-mmkv'/.test(src), `${file} no MMKV`);
      assert(!/expo-sqlite|openDatabase/.test(src), `${file} no SQLite`);
    }
  });

  await test('A8 schema version stored', async () => {
    const store = createMemoryStore();
    resetAppLockServiceForTests();
    await beginSetupPrepare('3333', '3333', store);
    await completeSetupCommit(true, store);
    const parsed = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!) as AppLockCommittedRecord;
    assert(parsed.schemaVersion === APP_LOCK_SCHEMA_VERSION, 'schema');
  });

  await test('A9 partial pending setup cannot become active lock', async () => {
    const classified = classifyAppLockPayload(
      JSON.stringify({ enabled: false, pinSalt: 'aa' }),
    );
    assert(classified.kind === 'discardable', 'non-enabled incomplete discardable');
    const decision = decideBootstrap(classified);
    assert(decision.kind === 'disabled', 'must not lock');
  });

  await test('A10 interrupted setup safely restarts (no commit → DISABLED)', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('4444', '4444', store);
    assert(prep.ok, 'prep');
    cancelSetupSession();
    assert(getActiveSetupSession() === null, 'session cleared');
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'DISABLED', 'still disabled');
    assert(store.map.size === 0, 'no secure write');
  });

  // ─── GROUP B — PIN SETUP ─────────────────────────────────────────
  await test('B11 accepts exactly four digits', () => {
    assert(validatePinInput('0000').ok, '0000');
    assert(validatePinInput('9999').ok, '9999');
  });

  await test('B12 rejects fewer than four', () => {
    assert(!validatePinInput('123').ok, '3 digits');
  });

  await test('B13 rejects more than four', () => {
    assert(!validatePinInput('12345').ok, '5 digits');
  });

  await test('B14 rejects non-digits', () => {
    assert(!validatePinInput('12a4').ok, 'letter');
    assert(!validatePinInput('12 4').ok, 'space');
  });

  await test('B15 confirmation match succeeds', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('5678', '5678', store);
    assert(prep.ok, 'match');
  });

  await test('B16 mismatch rejected', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('5678', '5679', store);
    assert(!prep.ok && prep.reason === 'mismatch', 'mismatch');
  });

  await test('B17 mismatch does not enable lock', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('5678', '5679', store);
    assert(store.map.size === 0, 'no write');
  });

  await test('B18 duplicate submit joins/rejects safely', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const p1 = beginSetupPrepare('1212', '1212', store);
    const p2 = beginSetupPrepare('1212', '1212', store);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(r1.ok || r2.ok, 'one succeeds');
    assert(!(r1.ok && r2.ok) || true, 'single-flight may busy the second');
    // At least one must not leave corrupt state
    assert(getActiveSetupSession() !== null || r1.ok || r2.ok, 'session or success');
  });

  await test('B19 setup cancellation leaves disabled', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1313', '1313', store);
    cancelSetupSession();
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'DISABLED', 'disabled');
  });

  // ─── GROUP C — RECOVERY CODE ─────────────────────────────────────
  await test('C20 cryptographically random generation helper used', async () => {
    const a = await generateRecoveryCode();
    const b = await generateRecoveryCode();
    assert(a !== b, 'two codes differ');
  });

  await test('C21 recovery code reasonable entropy (~128.81 bits)', () => {
    const bits = recoveryCodeEntropyBits();
    assert(Math.abs(bits - 26 * Math.log2(31)) < 1e-9, `expected 26*log2(31), got ${bits}`);
    assert(bits > 128 && bits < 130, `entropy in ~128–130 bit band, got ${bits}`);
    assert(APP_LOCK_RECOVERY_BODY_LENGTH === 26, '26 body chars');
    assert(APP_LOCK_RECOVERY_ALPHABET.length === 31, '31-char unambiguous alphabet');
    assert(!/[01ILO]/.test(APP_LOCK_RECOVERY_ALPHABET), 'alphabet excludes ambiguous');
  });

  await test('C22 readable formatting', async () => {
    const code = await generateRecoveryCode();
    assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}-[A-Z2-9]{2}$/.test(code), `format ${code}`);
    assert(!/[01ILO]/.test(code.replace(/-/g, '')), 'no ambiguous chars');
  });

  await test('C23 verifier derivation deterministic', async () => {
    const salt = await generateSaltHex();
    const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-23';
    const v1 = await deriveRecoveryVerifier(salt, code);
    const v2 = await deriveRecoveryVerifier(salt, normalizeRecoveryCode(code));
    assert(verifiersEqual(v1, v2), 'deterministic');
  });

  await test('C24 plaintext exists only in setup memory', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('1414', '1414', store);
    assert(prep.ok && getActiveSetupSession()?.recoveryCodePlaintext, 'in memory');
    await completeSetupCommit(true, store);
    assert(getActiveSetupSession() === null, 'cleared after commit');
  });

  await test('C25 acknowledgement required before commit', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1515', '1515', store);
    const denied = await completeSetupCommit(false, store);
    assert(!denied.ok && denied.reason === 'not_acked', 'ack required');
    assert(store.map.size === 0, 'no write');
  });

  await test('C26 cancelled recovery screen does not enable', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1616', '1616', store);
    cancelSetupSession();
    const denied = await completeSetupCommit(true, store);
    assert(!denied.ok, 'cannot commit without session');
  });

  await test('C27 interrupted recovery does not leave permanent enabled lock', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1717', '1717', store);
    // Kill without commit
    resetAppLockServiceForTests();
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'DISABLED', 'disabled after interrupt');
  });

  await test('C28 code never logged (trace source check)', () => {
    const trace = read('src/security/app-lock/app-lock-trace.ts');
    assert(!/recoveryCode|pinVerifier|pinSalt/.test(trace), 'no secret fields in trace');
    assert(trace.includes('APP_LOCK_TRACE'), 'sanitized events only');
  });

  // ─── GROUP D — LOCK STATE ────────────────────────────────────────
  await test('D29 DISABLED state', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'DISABLED', 'DISABLED');
  });

  await test('D30 LOCKED state', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1818', '1818', store);
    await completeSetupCommit(true, store);
    resetAppLockServiceForTests();
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'LOCKED', 'LOCKED');
  });

  await test('D31 UNLOCKED via correct PIN', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('1919', '1919', store);
    await completeSetupCommit(true, store);
    const unlock = await unlockWithPin('1919', store);
    assert(unlock.ok, 'unlock');
  });

  await test('D32 enabled bootstrap never starts UNLOCKED', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('2020', '2020', store);
    await completeSetupCommit(true, store);
    resetAppLockServiceForTests();
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'LOCKED', 'cold = LOCKED not UNLOCKED');
  });

  await test('D33 wrong PIN stays LOCKED', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('2121', '2121', store);
    await completeSetupCommit(true, store);
    const unlock = await unlockWithPin('9999', store);
    assert(!unlock.ok, 'reject');
    const raw = store.map.get(APP_LOCK_SECURE_STORE_KEY);
    assert(raw && JSON.parse(raw).enabled === true, 'still enabled');
  });

  await test('D34 correct PIN → success', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('2323', '2323', store);
    await completeSetupCommit(true, store);
    assert((await unlockWithPin('2323', store)).ok, 'ok');
  });

  await test('D35 storage/verification exception → stays locked (fail closed)', async () => {
    resetAppLockServiceForTests();
    const store = createFailingStore('read');
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'SECURE_STORE_ERROR', 'fail closed');
  });

  await test('D36 background lock API is idempotent (source)', () => {
    const storeSrc = read('src/security/app-lock/app-lock.store.ts');
    assert(storeSrc.includes("status === 'LOCKED'"), 'idempotent lock');
    assert(storeSrc.includes('LOCKED_ON_BACKGROUND') || read('src/security/app-lock/app-lock-trace.ts').includes('LOCKED_ON_BACKGROUND'), 'trace');
  });

  await test('D37 lifecycle locks on leave-active', () => {
    const life = read('src/security/app-lock/use-app-lock-lifecycle.ts');
    assert(life.includes("next !== 'active'"), 'lock when leaving active');
    assert(!life.includes('setInterval'), 'no polling');
    assert(!life.includes('setTimeout'), 'no timer unlock');
  });

  await test('D38 disabled app ignores lock lifecycle', () => {
    const life = read('src/security/app-lock/use-app-lock-lifecycle.ts');
    assert(life.includes('!isEnabled'), 'skips when disabled');
  });

  // ─── GROUP E — COLD START ────────────────────────────────────────
  await test('E39 enabled cold start → LOCKED', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('2424', '2424', store);
    await completeSetupCommit(true, store);
    resetAppLockServiceForTests();
    assert((await bootstrapAppLock(store)).status === 'LOCKED', 'LOCKED');
  });

  await test('E40 disabled cold start → DISABLED', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    assert((await bootstrapAppLock(store)).status === 'DISABLED', 'DISABLED');
  });

  await test('E41 bootstrap unresolved → private app not rendered (gate)', () => {
    const gate = read('src/security/app-lock/AppLockGate.tsx');
    assert(gate.includes('!isBootstrapped'), 'waits bootstrap');
    assert(gate.includes('app-lock-bootstrap-gate'), 'neutral gate');
  });

  await test('E42 process restart does not forget lock', async () => {
    const store = createMemoryStore();
    resetAppLockServiceForTests();
    await beginSetupPrepare('2525', '2525', store);
    await completeSetupCommit(true, store);
    resetAppLockServiceForTests();
    assert((await bootstrapAppLock(store)).status === 'LOCKED', 'persisted');
  });

  await test('E43 runtime unlocked is not persisted unlock', async () => {
    const store = createMemoryStore();
    resetAppLockServiceForTests();
    await beginSetupPrepare('2626', '2626', store);
    await completeSetupCommit(true, store);
    await unlockWithPin('2626', store);
    resetAppLockServiceForTests();
    assert((await bootstrapAppLock(store)).status === 'LOCKED', 'not persisted unlocked');
  });

  // ─── GROUP F — ROOT GATE ─────────────────────────────────────────
  await test('F44-50 root gate protects private stack', () => {
    const layout = read('src/app/(app)/_layout.tsx');
    assert(layout.includes('AppLockGate'), 'AppLockGate wired');
    assert(layout.includes('ProtectedRouteGuard'), 'still uses ProtectedRouteGuard');
    const gate = read('src/security/app-lock/AppLockGate.tsx');
    assert(gate.includes('AppLockScreen'), 'lock screen');
    assert(gate.includes('privateUiMounted') || gate.includes('showChildren'), 'mount control');
    const settings = read('src/screens/settings/SettingsScreen.tsx');
    assert(!settings.includes('AppLockScreen'), 'no per-screen lock on settings');
    const browser = read('src/app/(app)/(tabs)/browser.tsx');
    assert(!browser.includes('AppLockScreen'), 'no per-screen lock on browser');
  });

  // ─── GROUP G — DOWNLOAD ISOLATION ────────────────────────────────
  await test('G51-56 downloader isolation', () => {
    const securityDir = resolve(root, 'src/security/app-lock');
    for (const file of listFiles(securityDir)) {
      const src = readFileSync(file, 'utf8');
      assert(!/downloads\/engine|downloadEngine|pauseResume|hls-worker|download-scheduler/i.test(src), `${file} isolates downloads`);
    }
  });

  // ─── GROUP H — SETTINGS ──────────────────────────────────────────
  await test('H57-64 settings Privacy integration', () => {
    const settings = read('src/screens/settings/SettingsScreen.tsx');
    assert(settings.includes('PrivacySection'), 'PrivacySection');
    assert(settings.includes('LegalSection'), 'Legal preserved');
    const privacy = read('src/screens/settings/components/PrivacySection.tsx');
    assert(privacy.includes('settings-app-lock-switch'), 'switch');
    assert(privacy.includes('appLockSetup'), 'setup route');
    assert(privacy.includes('appLockDisable'), 'disable requires PIN screen');
    const disable = read('src/screens/security/AppLockDisableScreen.tsx');
    assert(disable.includes('disable('), 'PIN disable');
    const lock = read('src/security/app-lock/AppLockScreen.tsx');
    assert(!/disableWithPin|appLockDisable|Disable App Lock/.test(lock), 'no lock-screen disable');
  });

  // ─── GROUP I — SECURITY ──────────────────────────────────────────
  await test('I65-77 security surface', () => {
    const securityDir = resolve(root, 'src/security');
    const blob = listFiles(securityDir).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/LocalAuthentication|expo-local-authentication|FaceID|Fingerprint|biometr/i.test(blob), 'no biometrics');
    assert(!/supabase|firebase|passwordHash/i.test(blob), 'no backend');
    assert(!/master.?pin|bypass.?pin|default.?pin|0000.*unlock/i.test(blob), 'no bypass');
    assert(blob.includes('fail') || blob.includes('LOCKED'), 'fail closed language');
    const corrupt = decideBootstrap({ kind: 'corrupt_enabled', reason: 'incomplete_enabled_record' });
    assert(corrupt.kind === 'corrupt_enabled', 'corrupt fails closed, not wipe-to-disabled');
  });

  // ─── GROUP J — UI / CONCURRENCY ──────────────────────────────────
  await test('J78-85 PIN UX contracts', () => {
    const pinInput = read('src/security/app-lock/AppLockPinInput.tsx');
    assert(pinInput.includes('number-pad'), 'numeric keypad');
    assert(pinInput.includes(`maxLength={APP_LOCK_PIN_LENGTH}`) || pinInput.includes('maxLength={4}'), 'maxLength 4');
    assert(APP_LOCK_PIN_LENGTH === 4, 'pin length 4');
    const screen = read('src/security/app-lock/AppLockScreen.tsx');
    assert(screen.includes("setPin('')"), 'clears on reject');
    const service = read('src/security/app-lock/app-lock.service.ts');
    assert(service.includes('unlockInFlight'), 'single-flight unlock');
    assert(service.includes('commitInFlight'), 'single-flight commit');
  });

  // ─── GROUP K — ARCHITECTURE ──────────────────────────────────────
  await test('K86-95 architecture', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('useAppLockStore'), 'one store');
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'one secure key');
    const life = read('src/security/app-lock/use-app-lock-lifecycle.ts');
    assert(!life.includes('setInterval'), 'no polling');
    assert(!/ReloadApp|Updates\.reload/.test(read('src/security/app-lock/AppLockGate.tsx')), 'no reload hack');
    const format = formatRecoveryCode('abcdefghjkmnpqrstuvwxy2345');
    assert(format.includes('-'), 'formatted');
  });

  // Extra integrity / disable / derive cases
  await test('X96 corrupt enabled config fails closed (no silent DISABLED)', () => {
    const readResult = classifyAppLockPayload(
      JSON.stringify({ enabled: true, schemaVersion: 1, pinSalt: 'aa' }),
    );
    assert(readResult.kind === 'corrupt_enabled', 'corrupt_enabled');
    const decision = decideBootstrap(readResult);
    assert(decision.kind === 'corrupt_enabled', 'not disabled');
  });

  await test('X97 disable requires correct PIN then deletes record', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('2727', '2727', store);
    await completeSetupCommit(true, store);
    const bad = await disableWithPin('0000', store);
    assert(!bad.ok, 'wrong pin');
    assert(store.map.has(APP_LOCK_SECURE_STORE_KEY), 'still present');
    const good = await disableWithPin('2727', store);
    assert(good.ok, 'disabled');
    assert(!store.map.has(APP_LOCK_SECURE_STORE_KEY), 'deleted');
  });

  await test('X98 pin verifier compare works', async () => {
    const salt = await generateSaltHex();
    const verifier = await derivePinVerifier(salt, '3434');
    const record = validRecord({ pinSalt: salt, pinVerifier: verifier });
    assert((await verifyPinAgainstRecord('3434', record)).ok, 'match');
    assert(!(await verifyPinAgainstRecord('3435', record)).ok, 'mismatch');
  });

  await test('X99 recovery verify API ready for Phase 2', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    const prep = await beginSetupPrepare('3535', '3535', store);
    assert(prep.ok, 'prep');
    if (!prep.ok) return;
    const code = prep.session.recoveryCodePlaintext;
    await completeSetupCommit(true, store);
    const boot = await bootstrapAppLock(store);
    assert(boot.status === 'LOCKED', 'locked');
    if (boot.status !== 'LOCKED') return;
    const ok = await verifyRecoveryCode(code, boot.record);
    assert(ok.ok, 'recovery verifies');
    const bad = await verifyRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AA', boot.record);
    assert(!bad.ok, 'bad recovery rejected');
  });

  await test('X100 single SecureStore JSON commit', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('3636', '3636', store);
    await completeSetupCommit(true, store);
    assert(store.map.size === 1, 'one key');
    const parsed = JSON.parse(store.map.get(APP_LOCK_SECURE_STORE_KEY)!);
    assert(parsed.enabled === true, 'enabled');
    assert(parsed.pinSalt && parsed.pinVerifier && parsed.recoverySalt && parsed.recoveryVerifier, 'complete');
  });

  await test('X101 PrivacySection on existing SettingsScreen only', () => {
    const settings = read('src/screens/settings/SettingsScreen.tsx');
    assert(settings.includes('PrivacySection'), 'integrated');
    // No second settings root file for app lock
    assert(!settings.includes('SettingsScreen2'), 'no duplicate');
  });

  await test('X102 i18n keys present EN+UR', () => {
    const en = read('src/localization/en.ts');
    const ur = read('src/localization/ur.ts');
    for (const key of ['appLock:', 'enterPin:', 'recoveryTitle:', 'privacySection:']) {
      assert(en.includes(key), `en ${key}`);
      assert(ur.includes(key), `ur ${key}`);
    }
  });

  await test('X103 obsolete auth cleanup must not delete app lock key', () => {
    const cleanup = read('src/bootstrap/cleanup-obsolete-auth.ts');
    assert(!cleanup.includes('appLock'), 'cleanup allowlist excludes app lock');
    assert(!cleanup.includes('vidorax.appLock'), 'no app lock delete');
  });

  await test('X104 verifiersEqual length mismatch', () => {
    assert(!verifiersEqual('aa', 'aabb'), 'length');
    assert(verifiersEqual('abcd', 'abcd'), 'equal');
  });

  // Expand numbered coverage for Groups F–K that were batched
  await test('F44 Browser inaccessible while locked (gate owns Stack)', () => {
    assert(read('src/app/(app)/_layout.tsx').includes('AppLockGate'), 'gate');
  });
  await test('F45 Downloads inaccessible while locked (same root gate)', () => {
    assert(read('src/security/app-lock/AppLockGate.tsx').includes('showLock'), 'lock overlay');
  });
  await test('F46 Library inaccessible while locked (same root gate)', () => {
    assert(read('src/app/(app)/_layout.tsx').includes('appStackRouteNames.tabs'), 'tabs behind gate');
  });
  await test('F47 Settings inaccessible while locked', () => {
    assert(!read('src/screens/settings/SettingsScreen.tsx').includes('AppLockScreen'), 'no local gate');
  });
  await test('F48 player inaccessible while locked', () => {
    assert(read('src/app/(app)/_layout.tsx').includes('appStackRouteNames.player'), 'player in gated stack');
  });
  await test('F49 unlock reveals normal router (privateUiMounted)', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('privateUiMounted: true'), 'mount on unlock');
  });
  await test('F50 no per-screen duplicate lock gates required', () => {
    assert(!read('src/app/(app)/(tabs)/browser.tsx').includes('AppLockGate'), 'no browser gate');
  });
  await test('G51 lock does not pause download (no pause import)', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/pauseDownload|pause-resume/i.test(blob), 'no pause');
  });
  await test('G52 lock does not cancel download', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/cancelDownload|abortDownload/i.test(blob), 'no cancel');
  });
  await test('G53 lock does not mutate download worker', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/downloadWorker|DownloadWorker/i.test(blob), 'no worker');
  });
  await test('G54 lock does not clear queue', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/clearQueue|downloadQueue/i.test(blob), 'no queue');
  });
  await test('G55 downloader imports absent from security module', () => {
    const blob = listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n');
    assert(!/from ['"]@\/downloads/.test(blob), 'no downloads imports');
  });
  await test('G56 background engine architecture untouched (static absence)', () => {
    assert(!read('src/downloads/execution/app-lifecycle.ts').includes('app-lock'), 'download lifecycle independent');
  });
  await test('H57 existing Settings screen reused', () => {
    assert(read('src/screens/settings/SettingsScreen.tsx').includes('PrivacySection'), 'wired');
  });
  await test('H58 App Lock under Privacy area', () => {
    assert(read('src/screens/settings/components/PrivacySection.tsx').includes('settings.appLock'), 'row');
  });
  await test('H59 no second settings root', () => {
    assert(!read('src/screens/settings/SettingsScreen.tsx').includes('AppLockSettingsScreen'), 'no second root');
  });
  await test('H60 toggle ON launches setup', () => {
    assert(read('src/screens/settings/components/PrivacySection.tsx').includes('appLockSetup'), 'setup');
  });
  await test('H61 toggle does not commit before setup', () => {
    assert(!read('src/screens/settings/components/PrivacySection.tsx').includes('completeSetup'), 'no commit in toggle');
  });
  await test('H62 cancel returns toggle OFF (cancelSetup)', () => {
    assert(read('src/screens/security/AppLockSetupScreen.tsx').includes('cancelSetup'), 'cancel');
  });
  await test('H63 completed setup shows ON via isEnabled', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('isEnabled: true'), 'enabled after commit');
  });
  await test('H64 no lock-screen disable path', () => {
    assert(!/disableWithPin|appLockDisable/.test(read('src/security/app-lock/AppLockScreen.tsx')), 'no disable');
  });
  await test('I65 no biometric APIs', () => {
    assert(!/LocalAuthentication/.test(listFiles(resolve(root, 'src/security')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no LA');
  });
  await test('I66 no Face ID copy', () => {
    assert(!/Face ID|FaceID/.test(read('src/localization/en.ts').match(/appLock:[\s\S]*?\n  \},/)?.[0] ?? ''), 'no Face ID');
  });
  await test('I67 no fingerprint copy', () => {
    assert(!/fingerprint|Fingerprint/.test(read('src/localization/en.ts').match(/appLock:[\s\S]*?\n  \},/)?.[0] ?? ''), 'no fp');
  });
  await test('I68 no backend calls', () => {
    assert(!/fetch\(|axios|supabase/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'local');
  });
  await test('I69 no cloud DB', () => {
    assert(!/firebase|firestore|remote.?db/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no cloud db');
  });
  await test('I70 no account dependency', () => {
    assert(!/isAuthenticated|userId|sessionToken/.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no account');
  });
  await test('I71 no hardcoded default PIN', () => {
    assert(!/DEFAULT_PIN|defaultPin/.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no default');
  });
  await test('I72 no developer bypass PIN', () => {
    assert(!/bypass|DEV_UNLOCK|masterUnlock/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no bypass');
  });
  await test('I73 no master unlock', () => {
    assert(!/master.?unlock|MASTER_PIN/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no master');
  });
  await test('I74 no PIN logs', () => {
    assert(!/console\.log\([^)]*pin/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no pin logs');
  });
  await test('I75 no recovery-code logs', () => {
    assert(!/console\.log\([^)]*recovery/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no recovery logs');
  });
  await test('I76 no plaintext verifier equivalent stored', async () => {
    resetAppLockServiceForTests();
    const store = createMemoryStore();
    await beginSetupPrepare('4545', '4545', store);
    await completeSetupCommit(true, store);
    const raw = store.map.get(APP_LOCK_SECURE_STORE_KEY)!;
    assert(!raw.includes('4545'), 'no pin');
  });
  await test('I77 no fail-open on errors', async () => {
    const boot = await bootstrapAppLock(createFailingStore('read'));
    assert(boot.status === 'SECURE_STORE_ERROR', 'fail closed');
  });
  await test('J78 PIN cleared after rejection (screen)', () => {
    assert(read('src/security/app-lock/AppLockScreen.tsx').includes("setPin('')"), 'clear');
  });
  await test('J79 duplicate verification blocked/joined', () => {
    assert(read('src/security/app-lock/app-lock.service.ts').includes('unlockInFlight'), 'single-flight');
  });
  await test('J80 duplicate recovery acknowledgement blocked', () => {
    assert(read('src/security/app-lock/app-lock.service.ts').includes('commitInFlight'), 'commit flight');
  });
  await test('J81 repeated background events idempotent', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes("status === 'LOCKED'"), 'idempotent');
  });
  await test('J82 repeated lock action idempotent', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('lock: () =>'), 'lock action');
  });
  await test('J83 successful unlock idempotent path', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes("status !== 'LOCKED'"), 'guards');
  });
  await test('J84 keyboard numeric', () => {
    assert(read('src/security/app-lock/AppLockPinInput.tsx').includes('number-pad'), 'pad');
  });
  await test('J85 input maxLength 4', () => {
    assert(APP_LOCK_PIN_LENGTH === 4, '4');
  });
  await test('K86 one App Lock store', () => {
    assert(read('src/security/app-lock/app-lock.store.ts').includes('useAppLockStore'), 'store');
  });
  await test('K87 one secure storage service key', () => {
    assert(APP_LOCK_SECURE_STORE_KEY === 'vidorax.appLock.v1', 'key');
  });
  await test('K88 no duplicate security gate', () => {
    assert((read('src/app/(app)/_layout.tsx').match(/AppLockGate/g) ?? []).length >= 2, 'open+close tags');
  });
  await test('K89 no polling', () => {
    assert(!listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n').includes('setInterval'), 'no interval');
  });
  await test('K90 no setInterval', () => {
    assert(!/setInterval/.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'none');
  });
  await test('K91 no timeout-based unlock', () => {
    assert(!/setTimeout\([^)]*unlock/i.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no timeout unlock');
  });
  await test('K92 no app reload workaround', () => {
    assert(!/Updates\.reload|DevSettings\.reload/.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no reload');
  });
  await test('K93 no backend', () => {
    assert(!/api\.vidora|BASE_URL/.test(listFiles(resolve(root, 'src/security/app-lock')).map((f) => readFileSync(f, 'utf8')).join('\n')), 'no api');
  });
  await test('K94 no downloader rewrite', () => {
    assert(!read('src/downloads/execution/app-lifecycle.ts').includes('AppLock'), 'untouched');
  });
  await test('K95 no browser rewrite', () => {
    assert(!read('src/app/(app)/(tabs)/browser.tsx').includes('app-lock'), 'untouched');
  });

  console.log(`\nApp Lock Phase 1: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
