/**
 * Single controls auto-hide timer ownership (injectable clock for tests).
 */

export const CONTROLS_AUTO_HIDE_MS = 3000;

export type ControlsVisibilityInput = {
  isPlaying: boolean;
  isSeeking: boolean;
  isSpeedSheetOpen: boolean;
  isOrientationSheetOpen?: boolean;
  isLoading: boolean;
  hasError: boolean;
  isCompleted: boolean;
};

export function shouldForceControlsVisible(
  input: ControlsVisibilityInput,
): boolean {
  return (
    !input.isPlaying ||
    input.isSeeking ||
    input.isSpeedSheetOpen ||
    input.isOrientationSheetOpen === true ||
    input.isLoading ||
    input.hasError ||
    input.isCompleted
  );
}

export type ControlsVisibilityControllerOptions = {
  hideDelayMs?: number;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onChange?: (visible: boolean) => void;
};

export class ControlsVisibilityController {
  private visible = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly hideDelayMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private readonly onChange?: (visible: boolean) => void;
  private disposed = false;
  private forceVisible = false;

  constructor(options: ControlsVisibilityControllerOptions = {}) {
    this.hideDelayMs = options.hideDelayMs ?? CONTROLS_AUTO_HIDE_MS;
    this.now = options.now ?? (() => Date.now());
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
    this.onChange = options.onChange;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setForceVisible(force: boolean): void {
    this.forceVisible = force;
    if (force) {
      this.clearTimer();
      this.setVisible(true);
    } else {
      this.bump();
    }
  }

  show(): void {
    if (this.disposed) {
      return;
    }
    this.setVisible(true);
    this.scheduleHide();
  }

  hide(): void {
    if (this.disposed || this.forceVisible) {
      return;
    }
    this.clearTimer();
    this.setVisible(false);
  }

  toggle(): void {
    if (this.disposed) {
      return;
    }
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** User interaction — show and restart hide timer. */
  bump(): void {
    if (this.disposed) {
      return;
    }
    this.setVisible(true);
    this.scheduleHide();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private scheduleHide(): void {
    this.clearTimer();
    if (this.forceVisible || this.disposed) {
      return;
    }
    this.timer = this.setTimeoutFn(() => {
      this.timer = null;
      if (!this.forceVisible && !this.disposed) {
        this.setVisible(false);
      }
    }, this.hideDelayMs);
  }

  private clearTimer(): void {
    if (this.timer != null) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  private setVisible(next: boolean): void {
    if (this.visible === next) {
      return;
    }
    this.visible = next;
    this.onChange?.(next);
  }
}
