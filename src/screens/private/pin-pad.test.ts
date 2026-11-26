import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EMPTY_PIN_PAD, PIN_LENGTH, PIN_PAD_ROWS, pinPadRows, reducePinPad, type PinPadKey, type PinPadState } from './pin-pad';

function press(state: PinPadState, ...keys: PinPadKey[]): { state: PinPadState; completes: string[] } {
  const completes: string[] = [];
  let current = state;
  for (const key of keys) {
    const step = reducePinPad(current, { type: 'key', key });
    current = step.state;
    if (step.complete) completes.push(step.complete);
  }
  return { state: current, completes };
}

describe('Files F10 · design 28: the PIN pad', () => {
  test('typing fills the dots one digit at a time; the fingerprint key types nothing', () => {
    assert.equal(PIN_LENGTH, 4);
    const { state, completes } = press(EMPTY_PIN_PAD, '1', '2', 'biometric');
    assert.equal(state.digits, '12');
    assert.deepEqual(completes, []);
    assert.equal(state.wrong, false);
  });

  test('backspace removes the last digit, and does nothing on an empty pad', () => {
    assert.equal(press(EMPTY_PIN_PAD, '1', '2', 'backspace').state.digits, '1');
    assert.equal(press(EMPTY_PIN_PAD, 'backspace').state.digits, '');
    assert.equal(press(EMPTY_PIN_PAD, '9', 'backspace', 'backspace', '3').state.digits, '3');
  });

  test('a full PIN is handed over once, and more digits are ignored', () => {
    const { state, completes } = press(EMPTY_PIN_PAD, '4', '8', '1', '5', '6');
    assert.deepEqual(completes, ['4815']);
    assert.equal(state.digits, '4815');
  });

  test('a wrong PIN clears the dots, says "Wrong PIN" and shakes once; the next key clears the message', () => {
    const typed = press(EMPTY_PIN_PAD, '1', '1', '1', '1').state;
    const wrong = reducePinPad(typed, { type: 'wrong' }).state;
    assert.deepEqual(wrong, { digits: '', wrong: true, shakes: 1 });
    const again = reducePinPad(wrong, { type: 'wrong' }).state;
    assert.equal(again.shakes, 2);
    const next = press(again, '2').state;
    assert.equal(next.wrong, false);
    assert.equal(next.digits, '2');
    assert.deepEqual(reducePinPad(next, { type: 'clear' }).state, { digits: '', wrong: false, shakes: 2 });
  });

  test('the keypad is 1-2-3 on top in every language, with the fingerprint key only when it is offered', () => {
    assert.deepEqual(PIN_PAD_ROWS, [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
      ['biometric', '0', 'backspace'],
    ]);
    assert.deepEqual(pinPadRows(true)[3], ['biometric', '0', 'backspace']);
    assert.deepEqual(pinPadRows(false)[3], [null, '0', 'backspace']);
  });
});
