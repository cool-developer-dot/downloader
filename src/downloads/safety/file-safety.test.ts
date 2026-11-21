import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  allowFileAction,
  createDisguisedNotifier,
  fileSafetyWarning,
  normalizeFileSafety,
} from './file-safety';

describe('P8 #461 Malware Warning (JavaScript half)', () => {
  test('a disguised APK names what it really is', () => {
    const warning = fileSafetyWarning({ risky: true, reason: 'disguised', detected: 'apk' }, 'open');
    assert.deepEqual(warning, {
      titleKey: 'fileSafety.disguisedTitle',
      messageKey: 'fileSafety.disguisedMessage',
      kindKey: 'fileSafety.kindApk',
      proceedKey: 'fileSafety.openAnyway',
    });
  });

  test('double extension and plain programs get their own messages; the action names the button', () => {
    assert.equal(fileSafetyWarning({ risky: true, reason: 'double_extension', detected: null }, 'share')?.messageKey, 'fileSafety.doubleExtensionMessage');
    assert.equal(fileSafetyWarning({ risky: true, reason: 'double_extension', detected: null }, 'share')?.proceedKey, 'fileSafety.shareAnyway');
    assert.equal(fileSafetyWarning({ risky: true, reason: 'program', detected: 'exe' }, 'extract')?.titleKey, 'fileSafety.programTitle');
    assert.equal(fileSafetyWarning({ risky: true, reason: 'disguised', detected: null }, 'save')?.messageKey, 'fileSafety.disguisedMessageUnknown');
  });

  test('a safe or malformed verdict needs no warning', () => {
    assert.equal(fileSafetyWarning({ risky: false, reason: null, detected: null }, 'open'), null);
    assert.equal(fileSafetyWarning(normalizeFileSafety({ risky: true, reason: 'nonsense' }), 'open'), null);
    assert.equal(normalizeFileSafety(null), null);
    assert.deepEqual(normalizeFileSafety({ risky: true, reason: 'disguised', detected: 'virus' }), {
      risky: true,
      reason: 'disguised',
      detected: null,
    });
  });

  test('allowFileAction: safe files go on without asking; risky ones only when confirmed', async () => {
    let asked = 0;
    const confirm = async () => {
      asked += 1;
      return false;
    };
    assert.equal(await allowFileAction(async () => ({ risky: false, reason: null, detected: null }), 'open', confirm), true);
    assert.equal(asked, 0);
    assert.equal(await allowFileAction(async () => ({ risky: true, reason: 'disguised', detected: 'exe' }), 'open', confirm), false);
    assert.equal(asked, 1);
    assert.equal(await allowFileAction(async () => ({ risky: true, reason: 'disguised', detected: 'exe' }), 'open', async () => true), true);
  });

  test('allowFileAction: a check that fails (older build) never blocks; a confirm that throws is Cancel', async () => {
    assert.equal(await allowFileAction(async () => { throw new Error('ERR_NOT_FOUND'); }, 'share', async () => false), true);
    assert.equal(
      await allowFileAction(async () => ({ risky: true, reason: 'program', detected: 'apk' }), 'share', async () => {
        throw new Error('dialog');
      }),
      false,
    );
  });

  test('one notice per disguised link per run, only for known kinds', () => {
    const told: string[] = [];
    const notify = createDisguisedNotifier((kind, url) => told.push(`${kind}@${url}`));
    assert.equal(notify('https://x.example/a.mp4', 'apk'), true);
    assert.equal(notify('https://x.example/a.mp4', 'apk'), false);
    assert.equal(notify('https://x.example/b.mp4', 'virus'), false);
    assert.equal(notify('https://x.example/c.mp4', 'exe'), true);
    assert.deepEqual(told, ['apk@https://x.example/a.mp4', 'exe@https://x.example/c.mp4']);
  });
});
