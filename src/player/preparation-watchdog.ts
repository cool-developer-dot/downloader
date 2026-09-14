/**
 * Preparation watchdog — pure, injectable for tests.
 */

export const PREPARATION_TIMEOUT_MS = 12_000;

export type PreparationWatchdogOptions = {
  timeoutMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onTimeout: () => void;
};

export class PreparationWatchdog {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly onTimeout: () => void;
  private disposed = false;

  constructor(options: PreparationWatchdogOptions) {
    this.timeoutMs = options.timeoutMs ?? PREPARATION_TIMEOUT_MS;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.onTimeout = options.onTimeout;
  }

  start(): void {
    if (this.disposed) {
      return;
    }
    this.clear();
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      if (!this.disposed) {
        this.onTimeout();
      }
    }, this.timeoutMs);
  }

  clear(): void {
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  isArmed(): boolean {
    return this.timer != null;
  }
}
