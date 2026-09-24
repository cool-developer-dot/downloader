import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INITIAL_REVIEW_STATE,
  isCalmMoment,
  isCalmRoute,
  parseReviewState,
  recordReviewRequested,
  recordSuccessfulDownload,
  REVIEW_COUNTED_IDS_MAX,
  REVIEW_RECENT_SUCCESS_MS,
  REVIEW_REPEAT_INTERVAL_MS,
  REVIEW_ROUTE_SETTLE_MS,
  reviewEligibility,
  type CalmMomentInput,
  type ReviewState,
} from './review-policy.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_800_000_000_000;

function withDownloads(count: number, at = T0): ReviewState {
  let state = INITIAL_REVIEW_STATE;
  for (let i = 1; i <= count; i += 1) {
    state = recordSuccessfulDownload(state, `dl-${i}`, at);
  }
  return state;
}

const calm: CalmMomentInput = {
  appActive: true,
  appLocked: false,
  inFlightDownloads: 0,
  pathname: '/downloads',
  routeStableMs: REVIEW_ROUTE_SETTLE_MS,
};

test('the first request needs three genuine successful downloads', () => {
  assert.deepEqual(reviewEligibility(withDownloads(0), T0), { eligible: false, reason: 'not_enough_downloads' });
  assert.deepEqual(reviewEligibility(withDownloads(2), T0), { eligible: false, reason: 'not_enough_downloads' });
  assert.deepEqual(reviewEligibility(withDownloads(3), T0 + 5_000), { eligible: true });
});

test('each download is counted once, however often its completion is replayed', () => {
  let state = withDownloads(2);
  const again = recordSuccessfulDownload(state, 'dl-2', T0 + 1);
  assert.equal(again, state, 'a replayed completion changes nothing');
  state = recordSuccessfulDownload(state, '  ', T0 + 1);
  assert.equal(state.successfulDownloadCount, 2);
  assert.deepEqual(reviewEligibility(state, T0), { eligible: false, reason: 'not_enough_downloads' });
});

test('the request follows a recent success, not an old one', () => {
  const state = withDownloads(3, T0);
  assert.deepEqual(reviewEligibility(state, T0 + REVIEW_RECENT_SUCCESS_MS), { eligible: true });
  assert.deepEqual(reviewEligibility(state, T0 + REVIEW_RECENT_SUCCESS_MS + 1), {
    eligible: false,
    reason: 'no_recent_success',
  });
});

test('after a request the next one waits a week and needs new successful usage', () => {
  let state = recordReviewRequested(withDownloads(3, T0), T0);
  assert.equal(state.lastReviewRequestAt, T0);
  assert.equal(state.downloadsAtLastRequest, 3);

  // A day later, even after more successes: too soon.
  state = recordSuccessfulDownload(state, 'dl-4', T0 + DAY);
  assert.deepEqual(reviewEligibility(state, T0 + DAY), { eligible: false, reason: 'too_soon' });

  // Eight days later with a fresh success: allowed again.
  state = recordSuccessfulDownload(state, 'dl-5', T0 + 8 * DAY);
  assert.deepEqual(reviewEligibility(state, T0 + 8 * DAY + 1_000), { eligible: true });
});

test('a week passing is not enough without a new success', () => {
  const requested = recordReviewRequested(withDownloads(3, T0), T0 + 1_000);
  const later = T0 + REVIEW_REPEAT_INTERVAL_MS + 2_000;
  // The last success is old, and there is none since the request.
  assert.equal(reviewEligibility(requested, later).eligible, false);
  // Even a "recent" success timestamp without a new counted download does not qualify.
  const touched = { ...requested, lastSuccessAt: later };
  assert.deepEqual(reviewEligibility(touched, later), { eligible: false, reason: 'no_new_success' });
});

test('a clock set backwards never unlocks an early request', () => {
  const state = recordReviewRequested(withDownloads(3, T0), T0);
  assert.equal(reviewEligibility(state, T0 - DAY).eligible, false);
});

test('the counted id list stays bounded', () => {
  const state = withDownloads(REVIEW_COUNTED_IDS_MAX + 10);
  assert.equal(state.countedIds.length, REVIEW_COUNTED_IDS_MAX);
  assert.equal(state.successfulDownloadCount, REVIEW_COUNTED_IDS_MAX + 10);
});

test('only a settled Downloads or Player list with nothing downloading is calm', () => {
  assert.equal(isCalmMoment(calm), true);
  assert.equal(isCalmMoment({ ...calm, pathname: '/library' }), true);
  assert.equal(isCalmMoment({ ...calm, inFlightDownloads: 1 }), false, 'never during a download');
  assert.equal(isCalmMoment({ ...calm, pathname: '/player/dl-3' }), false, 'never over the player');
  assert.equal(isCalmMoment({ ...calm, pathname: '/browser' }), false, 'never while browsing');
  assert.equal(isCalmMoment({ ...calm, routeStableMs: REVIEW_ROUTE_SETTLE_MS - 1 }), false, 'never mid-navigation');
  assert.equal(isCalmMoment({ ...calm, appActive: false }), false);
  assert.equal(isCalmMoment({ ...calm, appLocked: true }), false, 'never over App Lock');
  assert.equal(isCalmRoute('/downloads/dl-3'), false, 'a download detail screen is not the list');
  assert.equal(isCalmRoute('/downloads/'), true);
});

test('a malformed stored state starts over instead of crashing', () => {
  assert.deepEqual(parseReviewState(undefined), INITIAL_REVIEW_STATE);
  assert.deepEqual(parseReviewState('{not json'), INITIAL_REVIEW_STATE);
  assert.deepEqual(parseReviewState('{"version":2}'), INITIAL_REVIEW_STATE);
  const restored = parseReviewState(
    JSON.stringify({
      version: 1,
      successfulDownloadCount: 4.7,
      countedIds: ['a', 7, 'b'],
      lastSuccessAt: T0,
      lastReviewRequestAt: -5,
      downloadsAtLastRequest: 'x',
      requestCount: 1,
    }),
  );
  assert.equal(restored.successfulDownloadCount, 4);
  assert.deepEqual(restored.countedIds, ['a', 'b']);
  assert.equal(restored.lastSuccessAt, T0);
  assert.equal(restored.lastReviewRequestAt, null);
  assert.equal(restored.downloadsAtLastRequest, 0);
});
