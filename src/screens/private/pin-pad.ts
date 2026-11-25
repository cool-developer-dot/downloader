/**
 * Files F10 · design 28: the PIN pad's state — the digits typed so far, ⌫, a full PIN handed to the existing App Lock
 * check, and a wrong PIN (the pad clears, shakes and says "Wrong PIN"). Pure; the PIN itself is checked by
 * `authenticatePin` with its throttling, exactly as before, and never kept after an attempt.
 *
 * The keypad is a phone keypad in every language: 1-2-3 on top, the fingerprint key, 0 and ⌫ at the bottom. It never
 * mirrors right to left.
 */

import { APP_LOCK_PIN_LENGTH } from '@/security/app-lock/app-lock.constants';

export const PIN_LENGTH: number = APP_LOCK_PIN_LENGTH;

export type PinPadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'biometric' | 'backspace';

/** The 3 × 4 keypad, left to right in every language. */
export const PIN_PAD_ROWS: readonly (readonly PinPadKey[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['biometric', '0', 'backspace'],
];

export type PinPadState = {
  digits: string;
  /** The last full PIN was wrong ("Wrong PIN" shows until the next key). */
  wrong: boolean;
  /** Bumped on every wrong PIN: the dots shake once per bump. */
  shakes: number;
};

export const EMPTY_PIN_PAD: PinPadState = { digits: '', wrong: false, shakes: 0 };

export type PinPadEvent =
  | { type: 'key'; key: PinPadKey }
  /** The App Lock check said no. */
  | { type: 'wrong' }
  /** Start again (after a right PIN, a throttle, or leaving). */
  | { type: 'clear' };

export type PinPadStep = {
  state: PinPadState;
  /** The full PIN to check, once, when the last digit is typed. */
  complete: string | null;
};

export function reducePinPad(state: PinPadState, event: PinPadEvent, length: number = PIN_LENGTH): PinPadStep {
  switch (event.type) {
    case 'key': {
      if (event.key === 'backspace') {
        return { state: { ...state, digits: state.digits.slice(0, -1), wrong: false }, complete: null };
      }
      if (event.key === 'biometric' || !/^\d$/.test(event.key) || state.digits.length >= length) {
        return { state, complete: null };
      }
      const digits = state.digits + event.key;
      return { state: { ...state, digits, wrong: false }, complete: digits.length === length ? digits : null };
    }
    case 'wrong':
      return { state: { digits: '', wrong: true, shakes: state.shakes + 1 }, complete: null };
    case 'clear':
      return { state: { ...state, digits: '', wrong: false }, complete: null };
    default:
      return { state, complete: null };
  }
}

/** The keypad's keys to draw: the fingerprint key only while a fingerprint (or face) unlock is offered. */
export function pinPadRows(biometricOffered: boolean): readonly (readonly (PinPadKey | null)[])[] {
  return PIN_PAD_ROWS.map((row) => row.map((key) => (key === 'biometric' && !biometricOffered ? null : key)));
}
