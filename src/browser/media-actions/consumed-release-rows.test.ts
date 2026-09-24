import assert from 'node:assert/strict';
import { test } from 'node:test';

import { newlyFailedForFreshSource } from './consumed-release-rows';

const running = { status: 'RUNNING', errorCode: null };

test('a row that has just failed for want of a fresh link is reported once', () => {
  for (const errorCode of ['SOURCE_EXPIRED', 'HTTP_403', 'HTTP_404']) {
    const failed = { status: 'FAILED', errorCode };
    assert.deepEqual(newlyFailedForFreshSource({ a: failed }, { a: running }), ['a']);
    assert.deepEqual(newlyFailedForFreshSource({ a: { ...failed } }, { a: failed }), []);
  }
});

test('other failures, other states and unchanged rows are not reported', () => {
  const noSpace = { status: 'FAILED', errorCode: 'NO_SPACE' };
  const completed = { status: 'COMPLETED', errorCode: null };
  const expired = { status: 'FAILED', errorCode: 'SOURCE_EXPIRED' };
  assert.deepEqual(newlyFailedForFreshSource({ a: noSpace }, { a: running }), []);
  assert.deepEqual(newlyFailedForFreshSource({ a: completed }, { a: running }), []);
  assert.deepEqual(newlyFailedForFreshSource({ a: expired, b: running }, { a: expired, b: running }), []);
  assert.deepEqual(newlyFailedForFreshSource({ a: expired, b: noSpace }, { b: running }), ['a']);
});
