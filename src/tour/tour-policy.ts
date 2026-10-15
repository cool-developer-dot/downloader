/**
 * The first-launch Browser tour: which steps exist, when it may start, and how Back / Next / Skip move through it.
 * Pure — no React Native, no storage — so every rule is unit tested (`tour-policy.test.ts`). The host
 * (`TourHost.tsx`) feeds it the live app state and persists the "seen" flag.
 */

/** MMKV flag: the user finished, skipped or closed the tour once. New installs and test1 upgrades both start unset. */
export const TOUR_SEEN_KEY = 'vidorax.tour.browser.v1';

export const TOUR_STEP_IDS = [
  'addressBar',
  'startPage',
  'videoAvailable',
  'downloadsTab',
  'playerTab',
  'settingsTab',
] as const;

export type TourStepId = (typeof TOUR_STEP_IDS)[number];

export const TOUR_STEP_COUNT = TOUR_STEP_IDS.length;

/** The Browser must have been idle this long before the tour starts, so it never flashes over a transition. */
export const TOUR_SETTLE_MS = 1_200;

export type TourAutoStartInput = {
  onboardingComplete: boolean;
  seen: boolean;
};

/**
 * Automatic start: once, after onboarding. Testers upgrading from test1 have onboarding done and no tour flag, so
 * they get it once too.
 */
export function shouldAutoStartTour({ onboardingComplete, seen }: TourAutoStartInput): boolean {
  return onboardingComplete && !seen;
}

export type TourMomentInput = {
  /** The Browser tab is the visible screen: no stacked screen (Settings page, Player, …) over it. */
  browserVisible: boolean;
  appActive: boolean;
  /** App Lock screen showing (or not yet unlocked). */
  appLocked: boolean;
  keyboardVisible: boolean;
  /** Open sheets, menus and dialogs. */
  openOverlays: number;
  /** A link the app was just opened with is on screen (see [linkDeferral]). */
  linkDeferred: boolean;
};

/** An idle Browser moment: nothing else on screen and nothing the user is in the middle of. */
export function isIdleBrowserMoment(input: TourMomentInput): boolean {
  return (
    input.browserVisible &&
    input.appActive &&
    !input.appLocked &&
    !input.keyboardVisible &&
    input.openOverlays === 0 &&
    !input.linkDeferred
  );
}

export type LinkDeferralEvent = 'link_opened' | 'start_page_shown' | 'app_returned_to_foreground';

/**
 * A link shared to or opened with VidoraX is what the user came for: the tour waits. It may run again once the
 * Browser is back on its start page, or the next time the user returns to the app.
 */
export function linkDeferral(deferred: boolean, event: LinkDeferralEvent): boolean {
  switch (event) {
    case 'link_opened':
      return true;
    case 'start_page_shown':
    case 'app_returned_to_foreground':
      return false;
    default:
      return deferred;
  }
}

export type TourStatus = 'idle' | 'running';

export type TourState = {
  status: TourStatus;
  stepIndex: number;
  /** The direction the user last moved, so a step without a target is skipped the same way. */
  direction: 1 | -1;
  /** A replay asked for from Settings / Help: starts at the next idle moment even though the tour was seen. */
  replayRequested: boolean;
};

export const INITIAL_TOUR_STATE: TourState = {
  status: 'idle',
  stepIndex: 0,
  direction: 1,
  replayRequested: false,
};

export type TourAction =
  | { type: 'start' }
  | { type: 'request_replay' }
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  /** The current step's target is not on screen: move on in the same direction, or end if nothing is left. */
  | { type: 'target_missing' };

export type TourTransition = {
  state: TourState;
  /** True when this action ended the tour (finished, skipped, closed): the caller persists "seen". */
  ended: boolean;
};

function end(state: TourState): TourTransition {
  return { state: { ...state, status: 'idle', stepIndex: 0, direction: 1, replayRequested: false }, ended: true };
}

export function reduceTour(state: TourState, action: TourAction): TourTransition {
  switch (action.type) {
    case 'start':
      if (state.status === 'running') {
        return { state, ended: false };
      }
      return { state: { status: 'running', stepIndex: 0, direction: 1, replayRequested: false }, ended: false };
    case 'request_replay':
      if (state.status === 'running') {
        return { state, ended: false };
      }
      return { state: { ...state, replayRequested: true }, ended: false };
    case 'next':
      if (state.status !== 'running') {
        return { state, ended: false };
      }
      if (state.stepIndex >= TOUR_STEP_COUNT - 1) {
        return end(state);
      }
      return { state: { ...state, stepIndex: state.stepIndex + 1, direction: 1 }, ended: false };
    case 'back':
      if (state.status !== 'running') {
        return { state, ended: false };
      }
      // Back on the first step closes the tour (Android Back key); the on-screen Back is hidden there.
      if (state.stepIndex === 0) {
        return end(state);
      }
      return { state: { ...state, stepIndex: state.stepIndex - 1, direction: -1 }, ended: false };
    case 'skip':
      return state.status === 'running' ? end(state) : { state, ended: false };
    case 'target_missing': {
      if (state.status !== 'running') {
        return { state, ended: false };
      }
      const next = state.stepIndex + state.direction;
      if (next >= TOUR_STEP_COUNT) {
        return end(state);
      }
      if (next < 0) {
        // Moving back past a missing first step: go forward again instead of closing the tour.
        return { state: { ...state, stepIndex: state.stepIndex + 1, direction: 1 }, ended: false };
      }
      return { state: { ...state, stepIndex: next }, ended: false };
    }
    default:
      return { state, ended: false };
  }
}

/**
 * Whether the tour starts at this moment: the Browser has been idle for [TOUR_SETTLE_MS] and either the automatic
 * first run is due or the user asked for a replay.
 */
export function shouldStartTourNow(input: {
  state: TourState;
  autoStart: TourAutoStartInput;
  moment: TourMomentInput;
  idleForMs: number;
}): boolean {
  if (input.state.status === 'running') {
    return false;
  }
  if (!input.state.replayRequested && !shouldAutoStartTour(input.autoStart)) {
    return false;
  }
  return isIdleBrowserMoment(input.moment) && input.idleForMs >= TOUR_SETTLE_MS;
}

/** The tour stays drawn only while the app is in front, unlocked and on the Browser; otherwise it waits, hidden. */
export function isTourPresentable(moment: Pick<TourMomentInput, 'browserVisible' | 'appActive' | 'appLocked'>): boolean {
  return moment.browserVisible && moment.appActive && !moment.appLocked;
}
