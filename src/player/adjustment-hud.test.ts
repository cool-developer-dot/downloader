import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ADJUSTMENT_HUD_HIDE_MS, createAdjustmentHud, type HudTimers } from './adjustment-hud';

/** Manual clock: timers fire only when the test advances time. */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: HudTimers = {
    setTimeout: (callback, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => {
      pending.delete(handle as unknown as number);
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, timer] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
      if (timer.at <= now) {
        pending.delete(id);
        timer.callback();
      }
    }
  };
  return { timers, advance, pendingCount: () => pending.size };
}

describe('brightness / volume indicator', () => {
  test('shows immediately and hides within the target window after the gesture ends', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    hud.show('brightness', 40);
    assert.deepEqual(hud.getSnapshot(), { kind: 'brightness', percent: 40, visible: true });
    hud.release();
    clock.advance(ADJUSTMENT_HUD_HIDE_MS - 1);
    assert.equal(hud.getSnapshot().visible, true);
    clock.advance(1);
    assert.equal(hud.getSnapshot().visible, false);
    assert.ok(ADJUSTMENT_HUD_HIDE_MS >= 400 && ADJUSTMENT_HUD_HIDE_MS <= 700);
  });

  test('repeated updates keep exactly one pending hide, and an update cancels it', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    for (let i = 0; i < 50; i += 1) {
      hud.show('volume', i);
      hud.release();
    }
    assert.equal(clock.pendingCount(), 1);
    assert.equal(hud.pendingHides(), 1);
    hud.show('volume', 60);
    assert.equal(clock.pendingCount(), 0, 'a value change while the finger is down never hides the indicator');
    clock.advance(10_000);
    assert.equal(hud.getSnapshot().visible, true);
    hud.release();
    clock.advance(ADJUSTMENT_HUD_HIDE_MS);
    assert.equal(hud.getSnapshot().visible, false);
    assert.equal(clock.pendingCount(), 0);
  });

  test('a release with nothing shown (a tap on the edge) schedules nothing', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    hud.release();
    assert.equal(clock.pendingCount(), 0);
    assert.equal(hud.getSnapshot().visible, false);
  });

  test('switching from brightness to volume reuses the single timer', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    hud.show('brightness', 10);
    hud.release();
    hud.show('volume', 80);
    assert.equal(hud.getSnapshot().kind, 'volume');
    assert.equal(clock.pendingCount(), 0);
    hud.release();
    assert.equal(clock.pendingCount(), 1);
  });

  test('hideNow and dispose leave no timer behind', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    hud.show('zoom', 150);
    hud.release();
    hud.hideNow();
    assert.equal(clock.pendingCount(), 0);
    assert.equal(hud.getSnapshot().visible, false);
    hud.show('zoom', 200);
    hud.release();
    hud.dispose();
    assert.equal(clock.pendingCount(), 0);
  });

  test('subscribers hear only real changes', () => {
    const clock = fakeTimers();
    const hud = createAdjustmentHud(clock.timers);
    let calls = 0;
    const unsubscribe = hud.subscribe(() => {
      calls += 1;
    });
    hud.show('brightness', 50);
    hud.show('brightness', 50);
    hud.show('brightness', 50.2);
    assert.equal(calls, 1);
    hud.show('brightness', 51);
    assert.equal(calls, 2);
    unsubscribe();
    hud.show('brightness', 52);
    assert.equal(calls, 2);
  });
});
