/**
 * P1 #545 Long Press to Fast Forward: while a finger rests on the picture the video plays at 2×; lifting it puts the
 * chosen speed back. The temporary rate goes to the player only (never to the session's speed, the 1.0× chip or the
 * media notification), so whatever ends the hold — the finger lifting, a lock, a sheet, picture-in-picture, the
 * Player closing or switching video — calls `end()` and the user's speed returns.
 */

export const LONG_PRESS_PLAYBACK_RATE = 2;

export type LongPressSpeedPorts = {
  /** Sets the player's rate without touching the session's chosen speed. */
  applyRate: (rate: number) => void;
  /** The speed the user chose, read when the hold ends. */
  chosenRate: () => number;
  onChange?: (active: boolean) => void;
};

export class LongPressSpeed {
  private active = false;
  private readonly ports: LongPressSpeedPorts;

  constructor(ports: LongPressSpeedPorts) {
    this.ports = ports;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Starts the hold; false (and nothing changes) when one is running or the video is not playing. */
  start(canStart: boolean): boolean {
    if (this.active || !canStart) {
      return false;
    }
    this.active = true;
    this.ports.applyRate(LONG_PRESS_PLAYBACK_RATE);
    this.ports.onChange?.(true);
    return true;
  }

  /** Ends a running hold and restores the chosen speed; a no-op otherwise, so every exit path may call it. */
  end(): void {
    if (!this.active) {
      return;
    }
    this.active = false;
    try {
      this.ports.applyRate(this.ports.chosenRate());
    } finally {
      this.ports.onChange?.(false);
    }
  }
}
