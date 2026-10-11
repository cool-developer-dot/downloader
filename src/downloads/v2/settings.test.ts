import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';

import type { DownloadSettings } from '@modules/vidorax-media/src/VidoraMedia.types';

import type { V2EnginePort } from './engine-port';
import {
  DEFAULT_CONNECTIONS_PER_FILE,
  normalizeConnectionsPerFile,
  pushV2DownloadSettings,
  resetV2SettingsForTests,
  sameV2Settings,
  v2DownloadSettings,
} from './settings';

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
      connectionsPerFile: 3,
    });
  });

  test('connections per file reach the engine, default 3, clamped to 1-4', () => {
    const base = { wifiOnly: false, maxConcurrentDownloads: 2 };
    assert.equal(DEFAULT_CONNECTIONS_PER_FILE, 3);
    assert.equal(v2DownloadSettings(base).connectionsPerFile, 3, 'an older stored setting without the field');
    assert.equal(v2DownloadSettings({ ...base, connectionsPerFile: 1 }).connectionsPerFile, 1);
    assert.equal(v2DownloadSettings({ ...base, connectionsPerFile: 4 }).connectionsPerFile, 4);
    assert.equal(v2DownloadSettings({ ...base, connectionsPerFile: 9 }).connectionsPerFile, 4);
    assert.equal(v2DownloadSettings({ ...base, connectionsPerFile: 0 }).connectionsPerFile, 1);
    assert.equal(normalizeConnectionsPerFile('2'), 2);
    assert.equal(normalizeConnectionsPerFile(Number.NaN), 3);
    assert.equal(normalizeConnectionsPerFile(null), 3);
    assert.equal(normalizeConnectionsPerFile(2.6), 3);
  });

  test('a changed connection count is a change to push', async () => {
    const { port, pushed } = engineSpy();
    await pushV2DownloadSettings(port, { wifiOnly: false, maxConcurrentDownloads: 2, connectionsPerFile: 3 });
    await pushV2DownloadSettings(port, { wifiOnly: false, maxConcurrentDownloads: 2, connectionsPerFile: 3 });
    await pushV2DownloadSettings(port, { wifiOnly: false, maxConcurrentDownloads: 2, connectionsPerFile: 1 });
    assert.deepEqual(
      pushed.map((s) => s.connectionsPerFile),
      [3, 1],
    );
    const a = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, connectionsPerFile: 2 });
    assert.equal(sameV2Settings(a, { ...a, connectionsPerFile: 4 }), false);
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
