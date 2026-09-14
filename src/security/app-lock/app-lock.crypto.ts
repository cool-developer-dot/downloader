/**
 * App Lock crypto helpers.
 *
 * Verifiers are one-way SHA-256 digests over a canonical payload.
 * JavaScript cannot guarantee true constant-time comparison; we use a
 * fixed-length XOR fold to avoid early-exit shortcuts where practical.
 */

import {
  APP_LOCK_DERIVE_CONTEXT_PIN,
  APP_LOCK_DERIVE_CONTEXT_RECOVERY,
  APP_LOCK_PIN_LENGTH,
  APP_LOCK_RECOVERY_ALPHABET,
  APP_LOCK_RECOVERY_BODY_LENGTH,
  APP_LOCK_SALT_BYTES,
  APP_LOCK_SCHEMA_VERSION,
} from './app-lock.constants';
import type { PinValidationResult } from './types';

export type AppLockCryptoPrimitives = {
  getRandomBytes: (byteLength: number) => Promise<Uint8Array>;
  sha256Hex: (payload: string) => Promise<string>;
};

let primitives: AppLockCryptoPrimitives | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

async function loadDefaultPrimitives(): Promise<AppLockCryptoPrimitives> {
  // Lazy require keeps Node verifiers able to inject before expo-crypto loads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as {
    getRandomBytesAsync: (n: number) => Promise<Uint8Array>;
    digestStringAsync: (algo: string, data: string) => Promise<string>;
    CryptoDigestAlgorithm: { SHA256: string };
  };
  return {
    getRandomBytes: (n) => Crypto.getRandomBytesAsync(n),
    sha256Hex: (payload) =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload),
  };
}

async function getPrimitives(): Promise<AppLockCryptoPrimitives> {
  if (primitives) {
    return primitives;
  }
  primitives = await loadDefaultPrimitives();
  return primitives;
}

/** Test-only: inject Node-compatible crypto before any derive/generate calls. */
export function setAppLockCryptoPrimitivesForTests(
  next: AppLockCryptoPrimitives | null,
): void {
  primitives = next;
}

export function validatePinInput(raw: string): PinValidationResult {
  if (raw.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (raw.length !== APP_LOCK_PIN_LENGTH) {
    return { ok: false, reason: 'length' };
  }
  if (!/^\d{4}$/.test(raw)) {
    return { ok: false, reason: 'non_digit' };
  }
  return { ok: true, pin: raw };
}

export async function generateSaltHex(
  byteLength: number = APP_LOCK_SALT_BYTES,
): Promise<string> {
  const crypto = await getPrimitives();
  const bytes = await crypto.getRandomBytes(byteLength);
  return bytesToHex(bytes);
}

/**
 * Canonical derive: SHA-256("v{schema}|{context}|{saltHex}|{secret}")
 */
export async function deriveVerifier(
  context: typeof APP_LOCK_DERIVE_CONTEXT_PIN | typeof APP_LOCK_DERIVE_CONTEXT_RECOVERY,
  saltHex: string,
  secret: string,
): Promise<string> {
  const crypto = await getPrimitives();
  const payload = `v${APP_LOCK_SCHEMA_VERSION}|${context}|${saltHex}|${secret}`;
  return crypto.sha256Hex(payload);
}

export async function derivePinVerifier(saltHex: string, pin: string): Promise<string> {
  return deriveVerifier(APP_LOCK_DERIVE_CONTEXT_PIN, saltHex, pin);
}

export async function deriveRecoveryVerifier(
  saltHex: string,
  recoveryCode: string,
): Promise<string> {
  const normalized = normalizeRecoveryCode(recoveryCode);
  return deriveVerifier(APP_LOCK_DERIVE_CONTEXT_RECOVERY, saltHex, normalized);
}

/**
 * Timing-safe-ish hex compare. Not cryptographically constant-time in JS engines.
 */
export function verifiersEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function formatRecoveryCode(body: string): string {
  const normalized = normalizeRecoveryCode(body);
  const parts: string[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    parts.push(normalized.slice(i, i + 4));
  }
  return parts.join('-');
}

/**
 * Cryptographically random recovery code.
 * Entropy: APP_LOCK_RECOVERY_BODY_LENGTH × log2(alphabet) ≈ 26 × log2(31) ≈ 128.81 bits.
 */
export async function generateRecoveryCode(): Promise<string> {
  const crypto = await getPrimitives();
  const alphabet = APP_LOCK_RECOVERY_ALPHABET;
  const alphabetLen = alphabet.length;
  const limit = Math.floor(256 / alphabetLen) * alphabetLen;
  const bodyChars: string[] = [];
  while (bodyChars.length < APP_LOCK_RECOVERY_BODY_LENGTH) {
    const needed = APP_LOCK_RECOVERY_BODY_LENGTH - bodyChars.length;
    const bytes = await crypto.getRandomBytes(needed + 8);
    for (let i = 0; i < bytes.length && bodyChars.length < APP_LOCK_RECOVERY_BODY_LENGTH; i += 1) {
      const value = bytes[i]!;
      if (value < limit) {
        bodyChars.push(alphabet[value % alphabetLen]!);
      }
    }
  }
  return formatRecoveryCode(bodyChars.join(''));
}

export function recoveryCodeEntropyBits(): number {
  return APP_LOCK_RECOVERY_BODY_LENGTH * Math.log2(APP_LOCK_RECOVERY_ALPHABET.length);
}
