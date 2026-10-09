/**
 * Brightness / volume / zoom indicator over the video.
 *
 * Shown the moment a gesture changes a value, hidden shortly after the gesture ends. Every update clears the one
 * pending hide, so a gesture of any length leaves a single timer behind and nothing lingers. It is a small external
 * store: only the indicator re-renders on a change, never the player screen.
 */

/**
 * Delay between the end of a gesture and the indicator starting to fade (the fade itself is 100 ms), so it is gone
 * about half a second after the finger lifts.
 */
export const ADJUSTMENT_HUD_HIDE_MS = 400;

export type AdjustmentHudKind = 'brightness' | 'volume' | 'zoom';

export type AdjustmentHudState = {
  kind: AdjustmentHudKind | null;
  percent: number;
  visible: boolean;
};

export const HIDDEN_ADJUSTMENT_HUD: AdjustmentHudState = { kind: null, percent: 0, visible: false };

type TimerHandle = ReturnType<typeof setTimeout>;

export type HudTimers = {
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type AdjustmentHud = {
  /** Shows (or updates) the indicator and cancels a pending hide. */
  show: (kind: AdjustmentHudKind, percent: number) => void;
  /** The gesture ended: hide after `ADJUSTMENT_HUD_HIDE_MS` unless it is shown again first. */
  release: () => void;
  /** Hide at once (a new video, PiP, the screen closing). */
  hideNow: () => void;
  getSnapshot: () => AdjustmentHudState;
  subscribe: (listener: () => void) => () => void;
  /** 0 or 1 — there is never more than one pending hide. */
  pendingHides: () => number;
  dispose: () => void;
};

const defaultTimers: HudTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle),
};

export function createAdjustmentHud(
  timers: HudTimers = defaultTimers,
  hideAfterMs: number = ADJUSTMENT_HUD_HIDE_MS,
): AdjustmentHud {
  let state: AdjustmentHudState = HIDDEN_ADJUSTMENT_HUD;
  let hideTimer: TimerHandle | null = null;
  const listeners = new Set<() => void>();

  const setState = (next: AdjustmentHudState) => {
    if (next.kind === state.kind && next.percent === state.percent && next.visible === state.visible) {
      return;
    }
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const cancelHide = () => {
    if (hideTimer !== null) {
      timers.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  return {
    show: (kind, percent) => {
      cancelHide();
      const clamped = Number.isFinite(percent) ? Math.round(percent) : 0;
      setState({ kind, percent: clamped, visible: true });
    },
    release: () => {
      cancelHide();
      if (!state.visible) {
        return;
      }
      hideTimer = timers.setTimeout(() => {
        hideTimer = null;
        setState(HIDDEN_ADJUSTMENT_HUD);
      }, hideAfterMs);
    },
    hideNow: () => {
      cancelHide();
      setState(HIDDEN_ADJUSTMENT_HUD);
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pendingHides: () => (hideTimer === null ? 0 : 1),
    dispose: () => {
      cancelHide();
      listeners.clear();
      state = HIDDEN_ADJUSTMENT_HUD;
    },
  };
}
