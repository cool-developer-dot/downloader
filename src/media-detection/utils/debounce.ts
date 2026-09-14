/**
 * Tiny debounce helper — avoids allocating timers when not needed.
 */
export function createDebounced<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  waitMs: number,
): ((...args: TArgs) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: TArgs | null = null;

  const run = (...args: TArgs) => {
    latest = args;
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const payload = latest;
      latest = null;
      if (payload) {
        fn(...payload);
      }
    }, waitMs);
  };

  run.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    latest = null;
  };

  run.flush = () => {
    if (!timer || !latest) {
      return;
    }
    clearTimeout(timer);
    timer = null;
    const payload = latest;
    latest = null;
    fn(...payload);
  };

  return run;
}
