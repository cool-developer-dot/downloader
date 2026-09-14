/**
 * Coalesce/throttle FGS summary updates before crossing the JS→native bridge.
 */

export type ThrottleController<T> = {
  /** Schedule an update; may coalesce with pending. */
  schedule: (value: T) => void;
  /** Flush immediately (e.g. active count change). */
  flush: (value?: T) => void;
  /** Cancel pending without emitting. */
  cancel: () => void;
  /** How many times `onEmit` was called. */
  getEmitCount: () => number;
};

export function createThrottleController<T>(options: {
  intervalMs: number;
  onEmit: (value: T) => void;
  now?: () => number;
}): ThrottleController<T> {
  let lastEmitAt = 0;
  let pending: T | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let emitCount = 0;
  const nowFn = options.now ?? (() => Date.now());

  const emit = (value: T) => {
    emitCount += 1;
    lastEmitAt = nowFn();
    pending = null;
    options.onEmit(value);
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value: T) {
      pending = value;
      const elapsed = nowFn() - lastEmitAt;
      if (elapsed >= options.intervalMs) {
        clearTimer();
        emit(value);
        return;
      }
      if (timer) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (pending != null) {
          emit(pending);
        }
      }, Math.max(0, options.intervalMs - elapsed));
    },

    flush(value?: T) {
      clearTimer();
      const next = value !== undefined ? value : pending;
      if (next != null) {
        emit(next);
      }
    },

    cancel() {
      clearTimer();
      pending = null;
    },

    getEmitCount() {
      return emitCount;
    },
  };
}
