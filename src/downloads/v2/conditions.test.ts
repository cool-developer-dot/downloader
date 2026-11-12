import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_DOWNLOAD_HOURS,
  downloadWindowForEngine,
  formatMinuteOfDay,
  formatWhen,
  normalizeDownloadHours,
  sameDownloadWindow,
  startAtFrom,
  stepMinuteOfDay,
  toggleDay,
  waitLabel,
  weekdayName,
} from './conditions';
import { sameV2Settings, v2DownloadSettings } from './settings';

/** Local wall time; 2026-10-12 is a Monday. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute, 0, 0).getTime();

const translate = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

test('download hours are off by default: 01:00–06:00 every day when first turned on', () => {
  assert.deepEqual(DEFAULT_DOWNLOAD_HOURS, { enabled: false, startMinute: 60, endMinute: 360, days: [1, 2, 3, 4, 5, 6, 7] });
  assert.equal(downloadWindowForEngine(DEFAULT_DOWNLOAD_HOURS), null);
  assert.equal(downloadWindowForEngine(null), null);
  assert.deepEqual(downloadWindowForEngine({ ...DEFAULT_DOWNLOAD_HOURS, enabled: true, days: [5, 1] }), {
    startMinute: 60,
    endMinute: 360,
    days: [1, 5],
  });
});

test('stored hours are repaired, never trusted', () => {
  assert.deepEqual(normalizeDownloadHours(undefined), DEFAULT_DOWNLOAD_HOURS);
  assert.deepEqual(normalizeDownloadHours('x'), DEFAULT_DOWNLOAD_HOURS);
  assert.deepEqual(
    normalizeDownloadHours({ enabled: true, startMinute: 1440, endMinute: -5, days: [9, 3, 3, 0, 2.5] }),
    { enabled: true, startMinute: 60, endMinute: 360, days: [3] },
  );
  assert.deepEqual(normalizeDownloadHours({ enabled: true, startMinute: 22 * 60, endMinute: 0, days: [] }).days, [
    1, 2, 3, 4, 5, 6, 7,
  ]);
  // The default object is never shared (the store mutates nothing, but a copy keeps it that way).
  assert.notEqual(normalizeDownloadHours(undefined).days, DEFAULT_DOWNLOAD_HOURS.days);
});

test('the time steppers move in quarter hours and wrap around midnight', () => {
  assert.equal(stepMinuteOfDay(60, 1), 75);
  assert.equal(stepMinuteOfDay(60, -1), 45);
  assert.equal(stepMinuteOfDay(0, -1), 1425);
  assert.equal(stepMinuteOfDay(1425, 1), 0);
  assert.equal(stepMinuteOfDay(67, 1), 75, 'an odd minute snaps to the quarter first');
  assert.equal(formatMinuteOfDay(0), '00:00');
  assert.equal(formatMinuteOfDay(125), '02:05');
  assert.equal(formatMinuteOfDay(1439), '23:59');
});

test('weekdays toggle but at least one stays', () => {
  assert.deepEqual(toggleDay([1, 2, 3], 2), [1, 3]);
  assert.deepEqual(toggleDay([1, 3], 7), [1, 3, 7]);
  assert.deepEqual(toggleDay([4], 4), [4]);
  assert.equal(weekdayName(1, 'en'), 'Mon');
  assert.equal(weekdayName(7, 'en'), 'Sun');
  assert.equal(weekdayName(5, 'ur'), 'جمعہ');
});

test('a changed window, rule or language is pushed again; an equal one is not', () => {
  const base = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2 });
  const hours = { ...DEFAULT_DOWNLOAD_HOURS, enabled: true };
  const withHours = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, downloadHours: hours });
  assert.equal(sameV2Settings(base, withHours), false);
  assert.equal(
    sameV2Settings(withHours, v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, downloadHours: { ...hours } })),
    true,
  );
  assert.equal(sameDownloadWindow({ startMinute: 1, endMinute: 2, days: [1] }, { startMinute: 1, endMinute: 2, days: [2] }), false);
  for (const key of ['notOnRoaming', 'pauseOnLowBattery', 'onlyWhileCharging'] as const) {
    const changed = v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, [key]: true });
    assert.equal(changed[key], true, key);
    assert.equal(sameV2Settings(base, changed), false, key);
  }
  assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, language: 'ur' }).language, 'ur');
  assert.equal(v2DownloadSettings({ wifiOnly: false, maxConcurrentDownloads: 2, language: 'fr' }).language, 'en');
});

test('wait labels name the rule, and the time when there is one', () => {
  const now = at(12, 20);
  assert.equal(waitLabel('scheduled', at(12, 23), now, 'en', translate), 'downloads.waitScheduled(time=23:00)');
  assert.equal(waitLabel('scheduled', at(13, 2), now, 'en', translate), 'downloads.waitScheduled(time=Tue 02:00)');
  assert.equal(waitLabel('scheduled', at(13, 2), now, 'ur', translate), 'downloads.waitScheduled(time=منگل 02:00)');
  assert.equal(waitLabel('scheduled', null, now, 'en', translate), 'downloads.waitScheduledNoTime');
  assert.equal(waitLabel('outside_hours', at(13, 1), now, 'en', translate), 'downloads.waitOutsideHours');
  assert.equal(waitLabel('roaming', null, now, 'en', translate), 'downloads.waitRoaming');
  assert.equal(waitLabel('charging', null, now, 'en', translate), 'downloads.waitCharging');
  assert.equal(waitLabel('battery_low', null, now, 'en', translate), 'downloads.waitBatteryLow');
  assert.equal(waitLabel(null, null, now, 'en', translate), null);
  assert.equal(waitLabel(undefined, null, now, 'en', translate), null);
});

test('"Start at…" today or tomorrow; a time already past today means tomorrow', () => {
  const now = at(12, 20, 10);
  assert.equal(startAtFrom('today', 22 * 60, now), at(12, 22));
  assert.equal(startAtFrom('tomorrow', 2 * 60, now), at(13, 2));
  assert.equal(startAtFrom('today', 2 * 60, now), at(13, 2));
  assert.equal(startAtFrom('today', 20 * 60 + 10, now), at(13, 20, 10), 'exactly now is past');
  assert.equal(formatWhen(at(12, 22), now, 'en'), '22:00');
  assert.equal(formatWhen(at(13, 2), now, 'en'), 'Tue 02:00');
});
