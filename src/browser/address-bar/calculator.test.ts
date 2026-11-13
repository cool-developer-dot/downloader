import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { evaluateCalculation, formatCalculatorValue } from './calculator.ts';

const value = (input: string) => evaluateCalculation(input)?.value ?? null;
const display = (input: string) => evaluateCalculation(input)?.display ?? null;

describe('address bar calculator (#268)', () => {
  test('precedence and parentheses', () => {
    assert.equal(value('12*(3+4)/2'), 42);
    assert.equal(value('2+3*4'), 14);
    assert.equal(value('(2+3)*4'), 20);
    assert.equal(value('10-4-3'), 3);
    assert.equal(value('2*-3'), -6);
  });

  test('powers are right-associative', () => {
    assert.equal(value('2^10'), 1024);
    assert.equal(value('2^3^2'), 512);
    assert.equal(value('2**8'), 256);
  });

  test('percent', () => {
    assert.equal(value('15% of 2000'), 300);
    assert.equal(value('50% * 80'), 40);
    assert.equal(value('200 + 10%'), 200.1);
  });

  test('Eastern digits and symbols', () => {
    assert.equal(value('۱۲+۳'), 15);
    assert.equal(value('٤٥ × ٢'), 90);
    assert.equal(value('10 ÷ 4'), 2.5);
    assert.equal(value('7 − 2'), 5);
    assert.equal(value('2٫5*2'), 5);
  });

  test('decimals and thousands separators', () => {
    assert.equal(value('1,000 * 3'), 3000);
    assert.ok(Math.abs(value('0.1+0.2')! - 0.3) < 1e-12);
    assert.equal(display('1/3'), '0.333333333333');
    assert.equal(display('0.1+0.2'), '0.3');
  });

  test('division by zero gives no suggestion', () => {
    assert.equal(evaluateCalculation('5/0'), null);
    assert.equal(evaluateCalculation('1/(2-2)'), null);
  });

  test('incomplete, invalid or plain input gives none', () => {
    for (const input of ['12*', '(3+4', '3+4)', '42', '-5', '5%', 'cats', 'example.com', '2 + two', '', '   ', '1..2+3']) {
      assert.equal(evaluateCalculation(input), null, input);
    }
  });

  test('never evaluates code', () => {
    for (const input of ['alert(1)', 'process.exit()', '1+1;alert(1)', 'Math.PI*2']) {
      assert.equal(evaluateCalculation(input), null, input);
    }
  });

  test('formatting', () => {
    assert.equal(formatCalculatorValue(-0), '0');
    assert.equal(formatCalculatorValue(2 ** 60), '1.152922e+18');
    assert.equal(formatCalculatorValue(1234567.5), '1234567.5');
  });
});
