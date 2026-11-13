import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isExpectingSystemScreen } from '@/security/app-lock/expected-system-screen';

import { isExternalUiOpen, withExternalUi } from './external-ui';

describe('Private pickers and App Lock (fix/app-lock-grace)', () => {
  test("Private's system screens are App Lock's expected system screens too", async () => {
    let section = false;
    let appLock = false;
    await withExternalUi(async () => {
      section = isExternalUiOpen();
      appLock = isExpectingSystemScreen();
    });
    assert.equal(section, true, 'Private stays unlocked while it is in front');
    assert.equal(appLock, true, 'App Lock grants its grace window for it');
    assert.equal(isExternalUiOpen(), false);
    assert.equal(isExpectingSystemScreen(), false);
  });

  test('a failing picker leaves neither marked', async () => {
    await assert.rejects(
      withExternalUi(async () => {
        throw new Error('no picker');
      }),
    );
    assert.equal(isExternalUiOpen(), false);
    assert.equal(isExpectingSystemScreen(), false);
  });
});
