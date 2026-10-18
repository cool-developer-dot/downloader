import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  getNotificationTogglePort,
  pushNotificationToggle,
  resetNotificationToggleForTests,
  setNotificationTogglePortForTests,
  type NotificationTogglePort,
} from './notification-toggle';

function fakePort(fail = false) {
  const pushed: boolean[] = [];
  const port: NotificationTogglePort = {
    async setDownloadNotificationsEnabled(enabled) {
      pushed.push(enabled);
      if (fail) {
        throw new Error('native failure');
      }
    },
  };
  return { port, pushed };
}

afterEach(() => {
  resetNotificationToggleForTests();
  setNotificationTogglePortForTests(undefined);
});

describe('"Download notifications" reaches the v2 runner', () => {
  test('the value is pushed, and only again when it changes', async () => {
    const { port, pushed } = fakePort();
    assert.equal(await pushNotificationToggle(port, true), true);
    assert.equal(await pushNotificationToggle(port, true), false);
    assert.equal(await pushNotificationToggle(port, false), true);
    assert.equal(await pushNotificationToggle(port, false), false);
    assert.equal(await pushNotificationToggle(port, true), true);
    assert.deepEqual(pushed, [true, false, true]);
  });

  test('a failed push is tried again with the next change and never throws', async () => {
    const failing = fakePort(true);
    assert.equal(await pushNotificationToggle(failing.port, false), false);
    const working = fakePort();
    assert.equal(await pushNotificationToggle(working.port, false), true, 'not remembered as pushed after the failure');
    assert.deepEqual(working.pushed, [false]);
  });

  test('a build without the native function pushes nothing', async () => {
    assert.equal(getNotificationTogglePort(), null);
    assert.equal(await pushNotificationToggle(null, false), false);
  });
});
