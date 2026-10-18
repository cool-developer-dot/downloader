import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  createAppLockLeaveController,
  isExpectingSystemScreen,
  resetExpectedSystemScreenForTests,
  SYSTEM_SCREEN_GRACE_MS,
  withExpectedSystemScreen,
} from './expected-system-screen';

function harness(expecting: () => boolean) {
  let now = 1_000;
  let locks = 0;
  const timers = new Map<number, { run: () => void; at: number }>();
  let nextHandle = 1;
  const controller = createAppLockLeaveController({
    lock: () => {
      locks += 1;
    },
    isExpecting: expecting,
    now: () => now,
    schedule: (run, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { run, at: now + ms });
      return handle;
    },
    clear: (handle) => {
      timers.delete(handle as number);
    },
  });
  return {
    controller,
    locks: () => locks,
    pendingTimers: () => timers.size,
    /** Moves the clock, running every timer that is due (as JavaScript would, unless suspended). */
    advance(ms: number, runTimers = true) {
      now += ms;
      if (!runTimers) {
        return;
      }
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.run();
        }
      }
    },
  };
}

afterEach(() => resetExpectedSystemScreenForTests());

describe('App Lock grace for system screens VidoraX opened (fix/app-lock-grace)', () => {
  test('a normal trip to the background locks at once, exactly as before', () => {
    const h = harness(() => false);
    h.controller.onChange('active', 'background');
    assert.equal(h.locks(), 1);
    assert.equal(h.pendingTimers(), 0);
    h.advance(5_000);
    h.controller.onChange('background', 'active');
    assert.equal(h.locks(), 1, 'coming back does not lock a second time');
  });

  test('back within the grace window from an expected system screen: still unlocked', () => {
    const h = harness(() => true);
    h.controller.onChange('active', 'background');
    assert.equal(h.locks(), 0);
    h.advance(SYSTEM_SCREEN_GRACE_MS - 1);
    h.controller.onChange('background', 'active');
    assert.equal(h.locks(), 0);
    assert.equal(h.pendingTimers(), 0, 'the grace timer is cancelled');
  });

  test('away longer than the grace window: the timer locks while still away', () => {
    const h = harness(() => true);
    h.controller.onChange('active', 'background');
    h.advance(SYSTEM_SCREEN_GRACE_MS);
    assert.equal(h.locks(), 1);
    h.controller.onChange('background', 'active');
    assert.equal(h.locks(), 1);
  });

  test('an expired grace window locks on return even when JavaScript timers did not run', () => {
    const h = harness(() => true);
    h.controller.onChange('active', 'background');
    h.advance(SYSTEM_SCREEN_GRACE_MS + 1, false);
    h.controller.onChange('background', 'active');
    assert.equal(h.locks(), 1);
  });

  test('inactive then background is one trip; the grace starts at the first one', () => {
    const h = harness(() => true);
    h.controller.onChange('active', 'inactive');
    h.advance(10_000);
    h.controller.onChange('inactive', 'background');
    h.advance(10_000);
    h.controller.onChange('background', 'active');
    assert.equal(h.locks(), 0);
  });

  test('only a trip that starts while the screen is expected gets the grace', () => {
    let expecting = true;
    const h = harness(() => expecting);
    h.controller.onChange('active', 'background');
    h.controller.onChange('background', 'active');
    expecting = false;
    h.controller.onChange('active', 'background');
    assert.equal(h.locks(), 1, 'the second trip (Home, recents…) locks at once');
  });

  test('dispose cancels a pending grace lock', () => {
    const h = harness(() => true);
    h.controller.onChange('active', 'background');
    h.controller.dispose();
    h.advance(SYSTEM_SCREEN_GRACE_MS * 2);
    assert.equal(h.locks(), 0);
  });

  test('withExpectedSystemScreen marks the screen only while it is open, even when it fails', async () => {
    assert.equal(isExpectingSystemScreen(), false);
    let inside = false;
    const value = await withExpectedSystemScreen(async () => {
      inside = isExpectingSystemScreen();
      return 'picked';
    });
    assert.equal(value, 'picked');
    assert.equal(inside, true);
    assert.equal(isExpectingSystemScreen(), false);

    await assert.rejects(
      withExpectedSystemScreen(async () => {
        throw new Error('no picker');
      }),
    );
    assert.equal(isExpectingSystemScreen(), false);
  });

  test('nested screens (a permission prompt, then a picker) count until the last one closes', async () => {
    let release: () => void = () => undefined;
    const outer = withExpectedSystemScreen(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await withExpectedSystemScreen(async () => undefined);
    assert.equal(isExpectingSystemScreen(), true);
    release();
    await outer;
    assert.equal(isExpectingSystemScreen(), false);
  });
});
