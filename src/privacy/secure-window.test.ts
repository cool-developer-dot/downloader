import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createSecureWindowArbiter,
  INCOGNITO_SECURE_OWNER,
  PRIVATE_FOLDER_SECURE_OWNER,
  privateFolderHoldsSecure,
} from './secure-window.ts';

/**
 * P11 #689 Block Screen Capture: when FLAG_SECURE is set and cleared, and how it shares the one native flag with
 * B11's incognito (the native side keeps one owner, so a "clear" from either would clear it for both).
 */

function arbiter() {
  const applied: boolean[] = [];
  return { applied, secure: createSecureWindowArbiter((secure) => applied.push(secure)) };
}

describe('P11 Block Screen Capture: the rule', () => {
  test('off by default: nothing is held; on: only while a Private screen is in front', () => {
    assert.equal(privateFolderHoldsSecure({ settingOn: false, screenFocused: true }), false);
    assert.equal(privateFolderHoldsSecure({ settingOn: true, screenFocused: false }), false);
    assert.equal(privateFolderHoldsSecure({ settingOn: true, screenFocused: true }), true);
  });
});

describe('P11 Block Screen Capture: sharing the flag with incognito', () => {
  test('set when the first asks, cleared when the last lets go, never twice for the same state', () => {
    const { applied, secure } = arbiter();
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, true);
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, true);
    assert.deepEqual(applied, [true]);
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, false);
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, false);
    assert.deepEqual(applied, [true, false]);
    assert.equal(secure.isSecure(), false);
  });

  test('incognito letting go while Private holds it keeps the window secure (and the other way round)', () => {
    const { applied, secure } = arbiter();
    secure.hold(INCOGNITO_SECURE_OWNER, true);
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, true);
    secure.hold(INCOGNITO_SECURE_OWNER, false);
    assert.equal(secure.isSecure(), true, 'Private still holds it');
    assert.deepEqual(applied, [true]);
    secure.hold(INCOGNITO_SECURE_OWNER, true);
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, false);
    assert.equal(secure.isSecure(), true, 'incognito still holds it');
    secure.hold(INCOGNITO_SECURE_OWNER, false);
    assert.deepEqual(applied, [true, false]);
    assert.deepEqual(secure.holders(), []);
  });

  test('leaving Private with the setting off never clears incognito’s flag', () => {
    const { applied, secure } = arbiter();
    secure.hold(INCOGNITO_SECURE_OWNER, true);
    // The Private screen focuses with the setting off, then leaves.
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, privateFolderHoldsSecure({ settingOn: false, screenFocused: true }));
    secure.hold(PRIVATE_FOLDER_SECURE_OWNER, false);
    assert.deepEqual(applied, [true]);
    assert.equal(secure.isSecure(), true);
  });

  test('incognito’s first “off” at start calls nothing (as before: nothing was secure)', () => {
    const { applied, secure } = arbiter();
    secure.hold(INCOGNITO_SECURE_OWNER, false);
    assert.deepEqual(applied, []);
  });

  test('a build without the native function: holding never throws', () => {
    const secure = createSecureWindowArbiter(() => {
      throw new Error('not linked');
    });
    assert.doesNotThrow(() => secure.hold(PRIVATE_FOLDER_SECURE_OWNER, true));
    assert.equal(secure.isSecure(), true);
  });
});
