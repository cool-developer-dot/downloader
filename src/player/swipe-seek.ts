/**
 * P8 #582 Horizontal Swipe Seek: a finger moved sideways over the picture shows where the video would go and by how
 * much ("12:34 (+0:45)"); the seek happens only when the finger lifts. Pure maths and a tiny store for the indicator,
 * so a swipe re-renders the indicator alone, never the Player screen.
 *
 * - Physical direction, like the double tap and the timeline (neither is mirrored in Urdu): right = forward.
 * - Normal sensitivity: a swipe across the whole picture is 90 seconds, so half the width is 45 s, whatever the
 *   video's length (the timeline is there for big jumps). Low and High scale it (`gesture-settings.ts`).
 * - The change is whole seconds, rounded before the clamp, so the target and the "+0:45" always agree.
 * - The target stays inside 0 … the video's length.
 */

import { formatPlaybackTime } from './format-time';
import { scaleSwipeDistance, type GestureSensitivity } from './gesture-settings';

/** How many seconds a swipe across the whole surface moves, at Normal sensitivity. */
export const SWIPE_SEEK_SECONDS_PER_WIDTH = 90;

export type SwipeSeekInput = {
  /** Where the video was when the swipe started (the player's own clock). */
  startSeconds: number;
  durationSeconds: number | null | undefined;
  /** How far the finger has moved sideways since the swipe started (dp; right is positive). */
  translationX: number;
  surfaceWidth: number;
  sensitivity?: GestureSensitivity | null;
};

export type SwipeSeekTarget = {
  /** Where the video goes when the finger lifts. */
  targetSeconds: number;
  /** The change that shows: `targetSeconds - startSeconds` (0 at either end of the video). */
  deltaSeconds: number;
};

/** Null when there is nothing to seek in (no width, no length, a broken position). */
export function swipeSeekTarget(input: SwipeSeekInput): SwipeSeekTarget | null {
  const { durationSeconds, surfaceWidth, translationX } = input;
  if (
    durationSeconds == null ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(surfaceWidth) ||
    surfaceWidth <= 0 ||
    !Number.isFinite(input.startSeconds)
  ) {
    return null;
  }
  const start = Math.min(durationSeconds, Math.max(0, input.startSeconds));
  const moved = Number.isFinite(translationX) ? translationX : 0;
  const raw = (scaleSwipeDistance(moved, input.sensitivity) / surfaceWidth) * SWIPE_SEEK_SECONDS_PER_WIDTH;
  // Rounded the same way in both directions (a swipe left is the mirror of a swipe right); `+ 0` turns -0 into 0.
  const change = Math.sign(raw) * Math.round(Math.abs(raw)) + 0;
  const unclamped = start + change;
  const targetSeconds = Math.min(durationSeconds, Math.max(0, unclamped));
  // Inside the video the change is exactly the whole seconds; at either end it is what is left.
  return { targetSeconds, deltaSeconds: targetSeconds === unclamped ? change : targetSeconds - start };
}

/** "+0:45", "−1:05", "+1:02:03"; minutes are not zero-padded. The minus is the typographic one (U+2212). */
export function formatSeekDelta(deltaSeconds: number): string {
  const seconds = Number.isFinite(deltaSeconds) ? Math.round(Math.abs(deltaSeconds)) : 0;
  const sign = seconds > 0 && deltaSeconds < 0 ? '−' : '+';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${s}` : `${sign}${m}:${s}`;
}

/** The indicator's text: "12:34 (+0:45)". Digits only, the same in every language. */
export function formatSwipeSeekLabel(target: SwipeSeekTarget): string {
  return `${formatPlaybackTime(target.targetSeconds)} (${formatSeekDelta(target.deltaSeconds)})`;
}

export type SwipeSeekHudState = {
  visible: boolean;
  targetSeconds: number;
  deltaSeconds: number;
};

export const HIDDEN_SWIPE_SEEK_HUD: SwipeSeekHudState = { visible: false, targetSeconds: 0, deltaSeconds: 0 };

export type SwipeSeekHud = {
  show: (target: SwipeSeekTarget) => void;
  hide: () => void;
  getSnapshot: () => SwipeSeekHudState;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
};

/** The indicator's store (read by `SwipeSeekHud` alone). A repeat of the same value notifies nobody. */
export function createSwipeSeekHud(): SwipeSeekHud {
  let state: SwipeSeekHudState = HIDDEN_SWIPE_SEEK_HUD;
  const listeners = new Set<() => void>();
  const setState = (next: SwipeSeekHudState) => {
    if (
      next.visible === state.visible &&
      next.targetSeconds === state.targetSeconds &&
      next.deltaSeconds === state.deltaSeconds
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    show: (target) => setState({ visible: true, targetSeconds: target.targetSeconds, deltaSeconds: target.deltaSeconds }),
    hide: () => setState(HIDDEN_SWIPE_SEEK_HUD),
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      listeners.clear();
      state = HIDDEN_SWIPE_SEEK_HUD;
    },
  };
}
