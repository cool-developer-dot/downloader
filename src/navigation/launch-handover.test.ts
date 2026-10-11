import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import {
  isLaunchHandedOver,
  isSplashShown,
  markLaunchHandedOver,
  markSplashShown,
  resetLaunchHandoverForTests,
  subscribeLaunchHandover,
} from './launch-handover';

afterEach(() => resetLaunchHandoverForTests());

test('the launch is handed over once, and listeners hear the splash and the handover', () => {
  let heard = 0;
  subscribeLaunchHandover(() => {
    heard += 1;
  });
  assert.equal(isLaunchHandedOver(), false);
  markSplashShown();
  markSplashShown();
  assert.equal(isSplashShown(), true);
  markLaunchHandedOver();
  markLaunchHandedOver();
  assert.equal(isLaunchHandedOver(), true);
  assert.equal(heard, 2);
});
