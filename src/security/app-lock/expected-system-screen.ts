/**
 * "Expected system screen" (fix/app-lock-grace): Android reports VidoraX as in the background while a system screen
 * it opened itself is in front — a file or folder picker, a permission prompt, Android's delete dialog. Such a screen
 * is part of what the user just asked for, so App Lock does not relock when VidoraX is back within
 * [SYSTEM_SCREEN_GRACE_MS]. Every other trip to the background locks at once, exactly as before; a return after the
 * grace window locks too.
 *
 * One shared helper: whoever opens such a screen wraps it in [withExpectedSystemScreen]. Pure (no React, no
 * AppState) so the rules are tested; `use-app-lock-lifecycle.ts` drives [createAppLockLeaveController].
 */

/** How long VidoraX may be away behind a system screen it opened without App Lock relocking. */
export const SYSTEM_SCREEN_GRACE_MS = 30_000;

let open = 0;

/** Runs `show` (which opens a system screen) so leaving for that screen starts the grace window, not a lock. */
export async function withExpectedSystemScreen<T>(show: () => Promise<T>): Promise<T> {
  open += 1;
  try {
    return await show();
  } finally {
    open = Math.max(0, open - 1);
  }
}

/** True while a system screen VidoraX opened is (or is about to be) in front. */
export function isExpectingSystemScreen(): boolean {
  return open > 0;
}

export function resetExpectedSystemScreenForTests(): void {
  open = 0;
}

type AppStateName = string;

export type AppLockLeaveDeps = {
  lock: () => void;
  isExpecting: () => boolean;
  now: () => number;
  schedule: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  graceMs?: number;
};

/**
 * The App Lock side of leaving and coming back. `onChange(prev, next)` is fed every AppState change:
 * - leaving the foreground for an expected system screen holds the lock for the grace window (a timer locks when
 *   it ends); leaving for anything else locks at once;
 * - coming back within the window keeps VidoraX unlocked; coming back later locks (if the timer did not already).
 */
export function createAppLockLeaveController(deps: AppLockLeaveDeps) {
  const graceMs = deps.graceMs ?? SYSTEM_SCREEN_GRACE_MS;
  let awaySince: number | null = null;
  let timer: unknown = null;

  function cancelTimer(): void {
    if (timer !== null) {
      deps.clear(timer);
      timer = null;
    }
  }

  function lockNow(): void {
    cancelTimer();
    awaySince = null;
    deps.lock();
  }

  return {
    onChange(prev: AppStateName, next: AppStateName): void {
      if (prev === 'active' && next !== 'active') {
        if (!deps.isExpecting()) {
          lockNow();
          return;
        }
        awaySince = deps.now();
        cancelTimer();
        timer = deps.schedule(() => {
          timer = null;
          if (awaySince !== null) {
            lockNow();
          }
        }, graceMs);
        return;
      }
      if (next === 'active' && awaySince !== null) {
        const away = deps.now() - awaySince;
        cancelTimer();
        awaySince = null;
        if (away > graceMs) {
          deps.lock();
        }
      }
    },

    /** The lifecycle ended (App Lock turned off, unmount): nothing pending stays behind. */
    dispose(): void {
      cancelTimer();
      awaySince = null;
    },
  };
}
