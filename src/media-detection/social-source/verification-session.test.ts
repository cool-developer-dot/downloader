import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import type { VerifiedSocialMediaVariant } from './types';
import { clearAllVerificationSessions, joinOrStartVerification } from './verification-session';

afterEach(() => {
  clearAllVerificationSessions();
});

const VARIANT = { variantId: 'v1' } as unknown as VerifiedSocialMediaVariant;

/** A verification the test finishes by hand; `signal` is what the shared job was given. */
function manualJob() {
  let finish: (value: VerifiedSocialMediaVariant | null) => void = () => undefined;
  const state: { signal: AbortSignal | null; runs: number } = { signal: null, runs: 0 };
  const start = (signal: AbortSignal) => {
    state.runs += 1;
    state.signal = signal;
    return new Promise<VerifiedSocialMediaVariant | null>((resolve) => {
      finish = resolve;
    });
  };
  return { start, state, finish: (value: VerifiedSocialMediaVariant | null) => finish(value) };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a caller that gives up does not cancel the verification another caller is waiting for', async () => {
  const job = manualJob();
  const first = new AbortController();
  const second = new AbortController();

  const a = joinOrStartVerification('k', job.start, first.signal);
  const b = joinOrStartVerification('k', job.start, second.signal);
  assert.equal(a.joined, false);
  assert.equal(b.joined, true);
  await tick();

  // The first caller moves on (a newer verification, a navigation) — the second still wants the answer.
  first.abort();
  assert.equal(job.state.signal?.aborted, false, 'the shared job must keep running');
  job.finish(VARIANT);
  assert.equal(await b.promise, VARIANT);
  assert.equal(job.state.runs, 1);
});

test('the shared verification is cancelled once every caller has given up', async () => {
  const job = manualJob();
  const first = new AbortController();
  const second = new AbortController();
  joinOrStartVerification('k', job.start, first.signal);
  joinOrStartVerification('k', job.start, second.signal);
  await tick();

  first.abort();
  second.abort();
  assert.equal(job.state.signal?.aborted, true);
});

test('an abandoned verification is never joined: the next caller starts a fresh one', async () => {
  const abandoned = manualJob();
  const caller = new AbortController();
  joinOrStartVerification('k', abandoned.start, caller.signal);
  await tick();
  caller.abort();

  const fresh = manualJob();
  const next = joinOrStartVerification('k', fresh.start, new AbortController().signal);
  assert.equal(next.joined, false);
  await tick();
  assert.equal(fresh.state.runs, 1);
  assert.equal(fresh.state.signal?.aborted, false);
  fresh.finish(VARIANT);
  assert.equal(await next.promise, VARIANT);
});

test('a full table makes room instead of refusing every later verification', async () => {
  for (let i = 0; i < 60; i += 1) {
    joinOrStartVerification(`stuck-${i}`, manualJob().start, new AbortController().signal);
  }
  const job = manualJob();
  const result = joinOrStartVerification('fresh', job.start, new AbortController().signal);
  await tick();
  assert.equal(job.state.runs, 1, 'the new verification must actually run');
  job.finish(VARIANT);
  assert.equal(await result.promise, VARIANT);
});

test('a caller without a signal keeps the verification alive', async () => {
  const job = manualJob();
  const withSignal = new AbortController();
  joinOrStartVerification('k', job.start);
  joinOrStartVerification('k', job.start, withSignal.signal);
  await tick();
  withSignal.abort();
  assert.equal(job.state.signal?.aborted, false);
});
