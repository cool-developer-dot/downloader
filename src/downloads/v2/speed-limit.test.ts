import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bandwidthFor } from './bandwidth';
import { sameV2Settings, v2DownloadSettings } from './settings';
import {
  normalizeSpeedLimit,
  SPEED_LIMIT_CHOICES,
  speedLimitForEngine,
  speedLimitLabel,
  speedLimitShortLabel,
} from './speed-limit';

test('the speed limit choices are Off, 256 KB/s, 512 KB/s, 1, 2 and 5 MB/s', () => {
  assert.deepEqual([...SPEED_LIMIT_CHOICES], [0, 262144, 524288, 1048576, 2097152, 5242880]);
});

test('stored values outside the choices mean no limit', () => {
  assert.equal(normalizeSpeedLimit(524288), 524288);
  assert.equal(normalizeSpeedLimit('1048576'), 1048576);
  for (const value of [undefined, null, -1, 1000, Number.NaN, 'fast', {}]) {
    assert.equal(normalizeSpeedLimit(value), 0, String(value));
  }
});

test('the engine gets null for no limit', () => {
  assert.equal(speedLimitForEngine(0), null);
  assert.equal(speedLimitForEngine(262144), 262144);
  assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2 }).speedLimitBytesPerSecond, null);
  assert.equal(
    v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, speedLimitBytesPerSecond: 2097152 })
      .speedLimitBytesPerSecond,
    2097152,
  );
});

test('a changed speed limit is pushed again', () => {
  const off = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2 });
  const limited = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, speedLimitBytesPerSecond: 524288 });
  assert.equal(sameV2Settings(off, limited), false);
  assert.equal(sameV2Settings(limited, { ...limited }), true);
});

test('labels', () => {
  assert.deepEqual(speedLimitLabel(0), { kind: 'off' });
  assert.deepEqual(speedLimitLabel(524288), { kind: 'kb', value: 512 });
  assert.deepEqual(speedLimitLabel(5242880), { kind: 'mb', value: 5 });
  assert.equal(speedLimitShortLabel(0, 'Off'), 'Off');
  assert.equal(speedLimitShortLabel(262144, 'Off'), '256K');
  assert.equal(speedLimitShortLabel(1048576, 'Off'), '1M');
});

test('a download without an entry has no limit and no priority', () => {
  const entries = [{ id: 'a', speedLimitBytesPerSecond: 262144, priority: true }];
  assert.deepEqual(bandwidthFor(entries, 'a'), { speedLimit: 262144, priority: true });
  assert.deepEqual(bandwidthFor(entries, 'b'), { speedLimit: 0, priority: false });
});
