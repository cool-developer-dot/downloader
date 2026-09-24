import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

// @ts-expect-error -- test stub export (scripts/test/app-module-hooks.mjs)
import { __activeBackSubscriptions } from 'react-native';

import {
  BACK_PRIORITY,
  __dispatchBackPressForTests,
  __resetBackOwnersForTests,
  registerBackOwner,
} from './back-handler-registry';

const activeSubscriptions = __activeBackSubscriptions as () => number;

describe('Android Back chain is ordered by priority, not registration time', () => {
  beforeEach(() => {
    __resetBackOwnersForTests();
  });

  test('the screen owner is consulted before the app-exit guard, whichever registered first', () => {
    for (const exitFirst of [true, false]) {
      __resetBackOwnersForTests();
      const calls: string[] = [];
      const screen = () => {
        calls.push('screen');
        return true;
      };
      const exit = () => {
        calls.push('exit');
        return true;
      };

      if (exitFirst) {
        registerBackOwner(BACK_PRIORITY.appExit, exit);
        registerBackOwner(BACK_PRIORITY.screen, screen);
      } else {
        registerBackOwner(BACK_PRIORITY.screen, screen);
        registerBackOwner(BACK_PRIORITY.appExit, exit);
      }

      assert.equal(__dispatchBackPressForTests(), true);
      assert.deepEqual(calls, ['screen']);
    }
  });

  test('an owner that declines falls through to the next one', () => {
    const calls: string[] = [];
    registerBackOwner(BACK_PRIORITY.appExit, () => {
      calls.push('exit');
      return true;
    });
    registerBackOwner(BACK_PRIORITY.screen, () => {
      calls.push('screen');
      return false;
    });

    assert.equal(__dispatchBackPressForTests(), true);
    assert.deepEqual(calls, ['screen', 'exit']);
  });

  test('a launch gate outranks both', () => {
    const calls: string[] = [];
    registerBackOwner(BACK_PRIORITY.screen, () => {
      calls.push('screen');
      return true;
    });
    registerBackOwner(BACK_PRIORITY.gate, () => {
      calls.push('gate');
      return true;
    });

    __dispatchBackPressForTests();
    assert.deepEqual(calls, ['gate']);
  });

  test('no owner claims the press → the system handles Back', () => {
    registerBackOwner(BACK_PRIORITY.screen, () => false);
    assert.equal(__dispatchBackPressForTests(), false);
  });

  test('many owners share one native subscription, released when the last unregisters', () => {
    const before = activeSubscriptions();
    const releaseA = registerBackOwner(BACK_PRIORITY.screen, () => false);
    const releaseB = registerBackOwner(BACK_PRIORITY.appExit, () => false);
    assert.equal(activeSubscriptions(), before + 1);

    releaseA();
    assert.equal(activeSubscriptions(), before + 1);
    releaseB();
    assert.equal(activeSubscriptions(), before);

    // Unregistering twice must not double-release.
    releaseB();
    assert.equal(activeSubscriptions(), before);
  });

  test('an unregistered owner never sees another press', () => {
    let seen = 0;
    const release = registerBackOwner(BACK_PRIORITY.screen, () => {
      seen += 1;
      return true;
    });
    __dispatchBackPressForTests();
    release();
    __dispatchBackPressForTests();
    assert.equal(seen, 1);
  });
});
