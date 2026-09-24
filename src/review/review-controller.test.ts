import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createReviewController, type ReviewControllerDeps } from './review-controller.ts';
import {
  INITIAL_REVIEW_STATE,
  REVIEW_REPEAT_INTERVAL_MS,
  REVIEW_ROUTE_SETTLE_MS,
  type CalmMomentInput,
  type ReviewState,
} from './review-policy.ts';

const calm: CalmMomentInput = {
  appActive: true,
  appLocked: false,
  inFlightDownloads: 0,
  pathname: '/library',
  routeStableMs: REVIEW_ROUTE_SETTLE_MS + 100,
};

function harness(overrides: Partial<ReviewControllerDeps> = {}) {
  let stored: ReviewState = INITIAL_REVIEW_STATE;
  let clock = 1_800_000_000_000;
  const requests: number[] = [];
  const deps: ReviewControllerDeps = {
    load: () => stored,
    save: (state) => {
      stored = state;
    },
    now: () => clock,
    isAvailable: async () => true,
    requestReview: async () => {
      requests.push(clock);
    },
    ...overrides,
  };
  const controller = createReviewController(deps);
  return {
    controller,
    requests,
    get stored() {
      return stored;
    },
    advance(ms: number) {
      clock += ms;
    },
  };
}

test('after the third successful download the official review flow is requested once, at a calm moment', async () => {
  const h = harness();
  h.controller.onDownloadCompleted('dl-1');
  h.controller.onDownloadCompleted('dl-2');
  assert.equal(await h.controller.maybeRequest(calm), 'ineligible');

  h.controller.onDownloadCompleted('dl-3');
  assert.equal(await h.controller.maybeRequest({ ...calm, inFlightDownloads: 1 }), 'not_calm');
  assert.equal(h.requests.length, 0, 'never while something downloads');

  assert.equal(await h.controller.maybeRequest(calm), 'requested');
  assert.equal(h.requests.length, 1);
  assert.equal(h.stored.requestCount, 1);

  // Returning to the list again the same day asks nothing.
  h.advance(60_000);
  assert.equal(await h.controller.maybeRequest(calm), 'ineligible');
  assert.equal(h.requests.length, 1);
});

test('a week later, after new successful usage, it may be requested again', async () => {
  const h = harness();
  for (const id of ['a', 'b', 'c']) h.controller.onDownloadCompleted(id);
  assert.equal(await h.controller.maybeRequest(calm), 'requested');

  h.advance(REVIEW_REPEAT_INTERVAL_MS + 60_000);
  assert.equal(await h.controller.maybeRequest(calm), 'ineligible', 'no new success yet');
  h.controller.onDownloadCompleted('d');
  assert.equal(await h.controller.maybeRequest(calm), 'requested');
  assert.equal(h.requests.length, 2);
});

test('without the Play Store nothing is requested and nothing is recorded', async () => {
  const h = harness({ isAvailable: async () => false });
  for (const id of ['a', 'b', 'c']) h.controller.onDownloadCompleted(id);
  assert.equal(await h.controller.maybeRequest(calm), 'unavailable');
  assert.equal(h.requests.length, 0);
  assert.equal(h.stored.lastReviewRequestAt, null);
});

test('a failing Play call is swallowed and still counts as the attempt', async () => {
  const h = harness({
    requestReview: async () => {
      throw new Error('ERR_STORE_REVIEW_FAILED');
    },
  });
  for (const id of ['a', 'b', 'c']) h.controller.onDownloadCompleted(id);
  assert.equal(await h.controller.maybeRequest(calm), 'failed');
  assert.notEqual(h.stored.lastReviewRequestAt, null, 'recorded before the call');
  assert.equal(await h.controller.maybeRequest(calm), 'ineligible', 'so a failure never turns into a retry loop');
});

test('when the attempt cannot be stored, Play is never asked (no way to repeat without a record)', async () => {
  let saves = 0;
  let asked = false;
  let stored: ReviewState = INITIAL_REVIEW_STATE;
  const controller = createReviewController({
    load: () => stored,
    save: (state) => {
      saves += 1;
      if (state.lastReviewRequestAt != null) {
        throw new Error('storage full');
      }
      stored = state;
    },
    now: () => 1_800_000_000_000,
    isAvailable: async () => true,
    requestReview: async () => {
      asked = true;
    },
  });
  for (const id of ['a', 'b', 'c']) controller.onDownloadCompleted(id);
  assert.equal(await controller.maybeRequest(calm), 'failed');
  assert.equal(asked, false);
  assert.equal(saves, 4);
});

test('overlapping calm moments ask once', async () => {
  let release: () => void = () => undefined;
  const h = harness({ requestReview: () => new Promise<void>((resolve) => { release = resolve; }) });
  for (const id of ['a', 'b', 'c']) h.controller.onDownloadCompleted(id);
  const first = h.controller.maybeRequest(calm);
  assert.equal(await h.controller.maybeRequest(calm), 'busy');
  release();
  assert.equal(await first, 'requested');
});

test('broken storage never throws out of the controller', async () => {
  const controller = createReviewController({
    load: () => {
      throw new Error('mmkv gone');
    },
    save: () => {
      throw new Error('mmkv gone');
    },
    now: () => 1,
    isAvailable: async () => true,
    requestReview: async () => assert.fail('never asked'),
  });
  controller.onDownloadCompleted('a');
  assert.equal(await controller.maybeRequest(calm), 'ineligible');
});

// --- Downloads that complete while JavaScript is not running -------------------------------------------------------

/** The engine's completion outbox (VidoraMedia `listCompletedDownloads` / `acknowledgeCompletedDownloads`). */
function outbox(initial: { id: string; completedAt: number }[] = []) {
  const rows = new Map(initial.map((row) => [row.id, row]));
  const source = {
    failAcknowledge: false,
    acknowledged: [] as string[],
    add(id: string, completedAt: number) {
      rows.set(id, { id, completedAt });
    },
    get pending() {
      return [...rows.keys()];
    },
    async listCompletedDownloads() {
      return [...rows.values()].sort((a, b) => a.completedAt - b.completedAt);
    },
    async acknowledgeCompletedDownloads(ids: string[]) {
      if (source.failAcknowledge) {
        throw new Error('native call failed');
      }
      for (const id of ids) {
        rows.delete(id);
        source.acknowledged.push(id);
      }
    },
  };
  return source;
}

test('downloads that completed while the app was closed are counted once each, then acknowledged', async () => {
  const h = harness();
  const T = 1_800_000_000_000;
  const source = outbox([
    { id: 'bg-1', completedAt: T - 3_000 },
    { id: 'bg-2', completedAt: T - 2_000 },
    { id: 'bg-3', completedAt: T - 1_000 },
  ]);

  assert.equal(await h.controller.reconcileCompletions(source), 3);
  assert.equal(h.stored.successfulDownloadCount, 3);
  assert.deepEqual(source.pending, [], 'acknowledged after counting');
  assert.equal(await h.controller.reconcileCompletions(source), 0, 'nothing left to count');
  assert.equal(h.stored.successfulDownloadCount, 3);
  // The three background completions make the user eligible at the next calm moment.
  assert.equal(await h.controller.maybeRequest(calm), 'requested');
});

test('a crash after counting but before the acknowledgement never counts a download twice', async () => {
  const h = harness();
  const source = outbox([{ id: 'bg-1', completedAt: 1_800_000_000_000 }]);
  source.failAcknowledge = true;

  assert.equal(await h.controller.reconcileCompletions(source), 1);
  assert.deepEqual(source.pending, ['bg-1'], 'still in the outbox');

  // Next start: a fresh controller over the same saved state reads the same outbox again.
  const restarted = createReviewController({
    load: () => h.stored,
    save: () => undefined,
    now: () => 1_800_000_000_000,
    isAvailable: async () => true,
    requestReview: async () => undefined,
  });
  source.failAcknowledge = false;
  assert.equal(await restarted.reconcileCompletions(source), 0);
  assert.equal(h.stored.successfulDownloadCount, 1);
  assert.deepEqual(source.pending, [], 'acknowledged this time');
});

test('when the count cannot be saved nothing is acknowledged, so it is counted later', async () => {
  let failSave = true;
  const h = harness({
    save: (state) => {
      if (failSave) {
        throw new Error('storage unavailable');
      }
      stored = state;
    },
    load: () => stored,
  });
  let stored = INITIAL_REVIEW_STATE;
  const source = outbox([{ id: 'bg-1', completedAt: 1_800_000_000_000 }]);

  assert.equal(await h.controller.reconcileCompletions(source), 0);
  assert.deepEqual(source.pending, ['bg-1']);

  failSave = false;
  assert.equal(await h.controller.reconcileCompletions(source), 1);
  assert.equal(stored.successfulDownloadCount, 1);
  assert.deepEqual(source.pending, []);
});

test('a download counted live and then reported by the outbox is still counted once', async () => {
  const h = harness();
  h.controller.onDownloadCompleted('live-1');
  const source = outbox([{ id: 'live-1', completedAt: 1_800_000_000_000 }]);
  assert.equal(await h.controller.reconcileCompletions(source), 0);
  assert.equal(h.stored.successfulDownloadCount, 1);
  assert.deepEqual(source.pending, [], 'acknowledged so it is not reported again');
});

test('startup, foreground and a live completion reconciling at once count each download once', async () => {
  const h = harness();
  const source = outbox([
    { id: 'a', completedAt: 1 },
    { id: 'b', completedAt: 2 },
  ]);
  const results = await Promise.all([
    h.controller.reconcileCompletions(source),
    h.controller.reconcileCompletions(source),
    h.controller.reconcileCompletions(source),
  ]);
  assert.equal(results.reduce((sum, n) => sum + n, 0), 2);
  assert.equal(h.stored.successfulDownloadCount, 2);
});

test('a completion from days ago counts toward the total but is not a recent success to ask after', async () => {
  const h = harness();
  const now = 1_800_000_000_000;
  const source = outbox([
    { id: 'old-1', completedAt: now - 5 * 24 * 60 * 60 * 1000 },
    { id: 'old-2', completedAt: now - 4 * 24 * 60 * 60 * 1000 },
    { id: 'old-3', completedAt: now - 3 * 24 * 60 * 60 * 1000 },
  ]);
  assert.equal(await h.controller.reconcileCompletions(source), 3);
  assert.equal(h.stored.successfulDownloadCount, 3);
  assert.equal(await h.controller.maybeRequest(calm), 'ineligible', 'the last success must be recent');
  h.controller.onDownloadCompleted('fresh');
  assert.equal(await h.controller.maybeRequest(calm), 'requested');
});
