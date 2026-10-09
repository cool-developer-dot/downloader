import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import { pushV2DownloadSettings, resetV2SettingsForTests, v2DownloadSettings } from './settings';

function engineSpy(): { port: V2EnginePort; pushed: DownloadSettings[] } {
  const pushed: DownloadSettings[] = [];
  const port = {
    setDownloadSettings: async (settings: DownloadSettings) => {
      pushed.push(settings);
    },
  } as unknown as V2EnginePort;
  return { port, pushed };
}

beforeEach(() => {
  resetV2SettingsForTests();
});

describe('v2 download settings', () => {
  test('the app preferences map onto the engine contract', () => {
    assert.deepEqual(v2DownloadSettings({ wifiOnly: true, maxConcurrentDownloads: 3 }), {
      maxConcurrent: 3,
      wifiOnly: true,
      autoSaveToGallery: true,
      preferredMaxHeight: null,
    });
  });

  test('finished videos go to the gallery unless the user turned it off', () => {
    assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2 }).autoSaveToGallery, true);
    assert.equal(
      v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, saveToGallery: true }).autoSaveToGallery,
      true,
    );
    assert.equal(
      v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, saveToGallery: false }).autoSaveToGallery,
      false,
    );
  });

  test('a concurrency the engine would refuse is clamped, never sent as-is', () => {
    assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 99 }).maxConcurrent, 4);
    assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 0 }).maxConcurrent, 1);
    assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: Number.NaN }).maxConcurrent, 1);
  });

  test('settings are pushed once and again only when they change', async () => {
    const { port, pushed } = engineSpy();
    await pushV2DownloadSettings(port, { wifiOnly: false, maxConcurrentDownloads: 2 });
    await pushV2DownloadSettings(port, { wifiOnly: false, maxConcurrentDownloads: 2 });
    assert.equal(pushed.length, 1, 'an unchanged setting is not pushed again');

    await pushV2DownloadSettings(port, { wifiOnly: true, maxConcurrentDownloads: 2 });
    assert.equal(pushed.length, 2);
    assert.equal(pushed[1]?.wifiOnly, true);
  });

  test('a build without the native module is not an error', async () => {
    assert.equal(await pushV2DownloadSettings(null, { wifiOnly: true, maxConcurrentDownloads: 2 }), null);
  });
});
