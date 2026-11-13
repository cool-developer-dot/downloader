import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sameV2Settings, v2DownloadSettings } from './settings';

const BASE = { wifiOnly: false, maxConcurrentDownloads: 2 };

describe('notification alert options (audit)', () => {
  test('values that are not booleans are never sent', () => {
    const settings = v2DownloadSettings({
      ...BASE,
      notificationSound: 'yes' as unknown as boolean,
      notificationVibrate: null as unknown as boolean,
      notificationSilent: 1 as unknown as boolean,
    });
    assert.equal('notificationSound' in settings, false);
    assert.equal('notificationVibrate' in settings, false);
    assert.equal('notificationSilent' in settings, false);
  });

  test('the first push with the options differs from a push made before they existed', () => {
    const before = v2DownloadSettings(BASE);
    const after = v2DownloadSettings({ ...BASE, notificationSound: true, notificationVibrate: false, notificationSilent: false });
    assert.equal(sameV2Settings(before, after), false);
  });
});
