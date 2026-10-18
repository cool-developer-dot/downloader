import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import { pushV2DownloadSettings, resetV2SettingsForTests, sameV2Settings, v2DownloadSettings } from './settings';

afterEach(() => resetV2SettingsForTests());

function recordingEngine(): V2EnginePort & { pushed: DownloadSettings[] } {
  const pushed: DownloadSettings[] = [];
  return {
    pushed,
    setDownloadSettings: async (settings: DownloadSettings) => void pushed.push(settings),
  } as unknown as V2EnginePort & { pushed: DownloadSettings[] };
}

const BASE = { wifiOnly: false, maxConcurrentDownloads: 2 };

describe('notification alert options in the engine settings', () => {
  test('a caller that gives none sends exactly what it sent before', () => {
    const settings = v2DownloadSettings(BASE);
    assert.equal('notificationSound' in settings, false);
    assert.equal('notificationVibrate' in settings, false);
    assert.equal('notificationSilent' in settings, false);
  });

  test('given options are passed through as they are', () => {
    assert.deepEqual(
      v2DownloadSettings({ ...BASE, notificationSound: true, notificationVibrate: false, notificationSilent: false }),
      {
        maxConcurrent: 2,
        wifiOnly: false,
        autoSaveToGallery: true,
        preferredMaxHeight: null,
        notificationSound: true,
        notificationVibrate: false,
        notificationSilent: false,
      },
    );
    const silent = v2DownloadSettings({ ...BASE, notificationSilent: true });
    assert.equal(silent.notificationSilent, true);
    assert.equal('notificationSound' in silent, false);
  });

  test('changing only an alert option is a change worth pushing', () => {
    const a = v2DownloadSettings({ ...BASE, notificationSound: true });
    const b = v2DownloadSettings({ ...BASE, notificationSound: false });
    assert.equal(sameV2Settings(a, b), false);
    assert.equal(sameV2Settings(a, v2DownloadSettings({ ...BASE, notificationSound: true })), true);
  });

  test('toggling vibrate pushes again; an unchanged push is skipped', async () => {
    const engine = recordingEngine();
    await pushV2DownloadSettings(engine, { ...BASE, notificationVibrate: false });
    await pushV2DownloadSettings(engine, { ...BASE, notificationVibrate: false });
    await pushV2DownloadSettings(engine, { ...BASE, notificationVibrate: true });
    assert.equal(engine.pushed.length, 2);
    assert.equal(engine.pushed[1]?.notificationVibrate, true);
  });
});
