import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INITIAL_TOUR_STATE,
  isIdleBrowserMoment,
  isTourPresentable,
  linkDeferral,
  reduceTour,
  shouldAutoStartTour,
  shouldStartTourNow,
  TOUR_SEEN_KEY,
  TOUR_SETTLE_MS,
  TOUR_STEP_COUNT,
  TOUR_STEP_IDS,
  type TourAction,
  type TourMomentInput,
  type TourState,
} from './tour-policy.ts';

const IDLE: TourMomentInput = {
  browserVisible: true,
  appActive: true,
  appLocked: false,
  keyboardVisible: false,
  openOverlays: 0,
  linkDeferred: false,
};

const NEW_INSTALL = { onboardingComplete: true, seen: false };

function run(actions: TourAction[], from: TourState = INITIAL_TOUR_STATE) {
  let state = from;
  let ended = false;
  for (const action of actions) {
    const result = reduceTour(state, action);
    state = result.state;
    ended = ended || result.ended;
  }
  return { state, ended };
}

const running = reduceTour(INITIAL_TOUR_STATE, { type: 'start' }).state;

test('six steps in the agreed order, behind a versioned flag', () => {
  assert.deepEqual(TOUR_STEP_IDS, ['addressBar', 'startPage', 'videoAvailable', 'downloadsTab', 'playerTab', 'settingsTab']);
  assert.equal(TOUR_STEP_COUNT, 6);
  assert.equal(TOUR_SEEN_KEY, 'vidorax.tour.browser.v1');
});

test('first launch: starts after onboarding, once', () => {
  assert.equal(shouldAutoStartTour({ onboardingComplete: false, seen: false }), false);
  assert.equal(shouldAutoStartTour(NEW_INSTALL), true);
  assert.equal(shouldAutoStartTour({ onboardingComplete: true, seen: true }), false);
});

test('upgrade from test1: onboarding done, flag never written → the tour shows once', () => {
  const upgraded = { onboardingComplete: true, seen: false };
  assert.equal(shouldStartTourNow({ state: INITIAL_TOUR_STATE, autoStart: upgraded, moment: IDLE, idleForMs: TOUR_SETTLE_MS }), true);
  // After it ended the flag is set: never again.
  assert.equal(
    shouldStartTourNow({
      state: INITIAL_TOUR_STATE,
      autoStart: { ...upgraded, seen: true },
      moment: IDLE,
      idleForMs: 60_000,
    }),
    false,
  );
});

test('waits for the Browser to settle', () => {
  assert.equal(shouldStartTourNow({ state: INITIAL_TOUR_STATE, autoStart: NEW_INSTALL, moment: IDLE, idleForMs: 0 }), false);
  assert.equal(
    shouldStartTourNow({ state: INITIAL_TOUR_STATE, autoStart: NEW_INSTALL, moment: IDLE, idleForMs: TOUR_SETTLE_MS - 1 }),
    false,
  );
});

test('never over App Lock, a dialog, the keyboard, another screen, or in the background', () => {
  const blocked: Partial<TourMomentInput>[] = [
    { appLocked: true },
    { openOverlays: 1 },
    { keyboardVisible: true },
    { browserVisible: false },
    { appActive: false },
    { linkDeferred: true },
  ];
  for (const change of blocked) {
    const moment = { ...IDLE, ...change };
    assert.equal(isIdleBrowserMoment(moment), false, JSON.stringify(change));
    assert.equal(
      shouldStartTourNow({ state: INITIAL_TOUR_STATE, autoStart: NEW_INSTALL, moment, idleForMs: 60_000 }),
      false,
      JSON.stringify(change),
    );
  }
  assert.equal(isIdleBrowserMoment(IDLE), true);
});

test('a link the app was opened with defers the tour until the start page or the next return', () => {
  let deferred = linkDeferral(false, 'link_opened');
  assert.equal(deferred, true);
  assert.equal(linkDeferral(deferred, 'start_page_shown'), false);
  deferred = linkDeferral(false, 'link_opened');
  assert.equal(linkDeferral(deferred, 'app_returned_to_foreground'), false);
});

test('a running tour hides (but keeps its step) while locked, backgrounded or off the Browser', () => {
  assert.equal(isTourPresentable(IDLE), true);
  assert.equal(isTourPresentable({ ...IDLE, appLocked: true }), false);
  assert.equal(isTourPresentable({ ...IDLE, appActive: false }), false);
  assert.equal(isTourPresentable({ ...IDLE, browserVisible: false }), false);
  // The keyboard and dialogs cannot appear under the tour's full-screen layer, so they do not hide it.
  assert.equal(isTourPresentable({ ...IDLE, keyboardVisible: true, openOverlays: 2 } as TourMomentInput), true);
  const midTour = run([{ type: 'start' }, { type: 'next' }, { type: 'next' }]).state;
  assert.equal(midTour.stepIndex, 2);
  assert.equal(shouldStartTourNow({ state: midTour, autoStart: NEW_INSTALL, moment: IDLE, idleForMs: 60_000 }), false);
});

test('Next walks all six steps; Next on the last one finishes', () => {
  const { state, ended } = run(Array.from({ length: 5 }, () => ({ type: 'next' }) as const), running);
  assert.equal(state.stepIndex, 5);
  assert.equal(ended, false);
  const finished = reduceTour(state, { type: 'next' });
  assert.equal(finished.ended, true);
  assert.equal(finished.state.status, 'idle');
});

test('Back goes to the previous step; Back on step 1 closes the tour', () => {
  const atThree = run([{ type: 'next' }, { type: 'next' }], running).state;
  const back = reduceTour(atThree, { type: 'back' });
  assert.equal(back.state.stepIndex, 1);
  assert.equal(back.state.direction, -1);
  assert.equal(back.ended, false);
  const closed = reduceTour(running, { type: 'back' });
  assert.equal(closed.ended, true);
  assert.equal(closed.state.status, 'idle');
});

test('Skip ends the tour from any step', () => {
  const atFour = run([{ type: 'next' }, { type: 'next' }, { type: 'next' }], running).state;
  const skipped = reduceTour(atFour, { type: 'skip' });
  assert.equal(skipped.ended, true);
  assert.equal(skipped.state.status, 'idle');
  // Skip while idle does nothing.
  assert.equal(reduceTour(INITIAL_TOUR_STATE, { type: 'skip' }).ended, false);
});

test('a missing target is skipped in the direction of travel, never pointed at', () => {
  // Forward: step 2 (start page) missing → step 3.
  const atTwo = reduceTour(running, { type: 'next' }).state;
  assert.equal(reduceTour(atTwo, { type: 'target_missing' }).state.stepIndex, 2);
  // Backward from step 3 into a missing step 2 → step 1.
  const backToTwo = run([{ type: 'next' }, { type: 'next' }, { type: 'back' }], running).state;
  assert.equal(backToTwo.stepIndex, 1);
  assert.equal(reduceTour(backToTwo, { type: 'target_missing' }).state.stepIndex, 0);
  // Missing first step while going back → forward again rather than closing.
  const backToOne = { ...running, direction: -1 as const };
  const forward = reduceTour(backToOne, { type: 'target_missing' });
  assert.equal(forward.ended, false);
  assert.equal(forward.state.stepIndex, 1);
  // Missing last step → the tour ends (counts as seen).
  const atLast = { ...running, stepIndex: 5 };
  const done = reduceTour(atLast, { type: 'target_missing' });
  assert.equal(done.ended, true);
});

test('replay: starts at the next idle moment even when the tour was seen', () => {
  const seen = { onboardingComplete: true, seen: true };
  const requested = reduceTour(INITIAL_TOUR_STATE, { type: 'request_replay' }).state;
  assert.equal(requested.replayRequested, true);
  assert.equal(shouldStartTourNow({ state: requested, autoStart: seen, moment: { ...IDLE, browserVisible: false }, idleForMs: 9_999 }), false);
  assert.equal(shouldStartTourNow({ state: requested, autoStart: seen, moment: IDLE, idleForMs: TOUR_SETTLE_MS }), true);
  const started = reduceTour(requested, { type: 'start' }).state;
  assert.equal(started.status, 'running');
  assert.equal(started.stepIndex, 0);
  assert.equal(started.replayRequested, false);
  // A replay request during a running tour changes nothing.
  assert.deepEqual(reduceTour(started, { type: 'request_replay' }).state, started);
});

test('start is idempotent and actions while idle are no-ops', () => {
  const atTwo = reduceTour(running, { type: 'next' }).state;
  assert.deepEqual(reduceTour(atTwo, { type: 'start' }).state, atTwo);
  for (const type of ['next', 'back', 'target_missing'] as const) {
    assert.deepEqual(reduceTour(INITIAL_TOUR_STATE, { type }), { state: INITIAL_TOUR_STATE, ended: false });
  }
});
