import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_DOWNLOAD_SETTINGS, normalizeDownloadSettings, settingsFromLegacy } from './settings-schema.ts';

describe('normalizeDownloadSettings', () => {
  test('contract defaults for missing or corrupt input', () => {
    assert.deepEqual(normalizeDownloadSettings(undefined), DEFAULT_DOWNLOAD_SETTINGS);
    assert.deepEqual(normalizeDownloadSettings('nope'), DEFAULT_DOWNLOAD_SETTINGS);
    assert.deepEqual(DEFAULT_DOWNLOAD_SETTINGS, {
      maxConcurrent: 2,
      wifiOnly: false,
      autoSaveToGallery: false,
      preferredMaxHeight: null,
    });
  });

  test('keeps valid values', () => {
    const settings = { maxConcurrent: 4, wifiOnly: true, autoSaveToGallery: true, preferredMaxHeight: 720 };
    assert.deepEqual(normalizeDownloadSettings(settings), settings);
  });

  test('replaces out-of-range values individually', () => {
    assert.deepEqual(
      normalizeDownloadSettings({ maxConcurrent: 9, wifiOnly: 'yes', autoSaveToGallery: true, preferredMaxHeight: 1440 }),
      { maxConcurrent: 2, wifiOnly: false, autoSaveToGallery: true, preferredMaxHeight: null },
    );
  });
});

test('settingsFromLegacy carries over concurrency and Wi-Fi only', () => {
  assert.deepEqual(
    settingsFromLegacy({ version: 1, settings: { maxConcurrentDownloads: 3, wifiOnly: true, autoResume: false } }),
    { ...DEFAULT_DOWNLOAD_SETTINGS, maxConcurrent: 3, wifiOnly: true },
  );
  assert.deepEqual(settingsFromLegacy(null), DEFAULT_DOWNLOAD_SETTINGS);
});
