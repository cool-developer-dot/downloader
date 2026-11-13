import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { formatRecordedTime, maxLengthLabel, recordingLine } from './live-recording';

describe('F6 live recording, as the Downloads row shows it', () => {
  test('the recorded length reads like a clock, hours only when there are some', () => {
    assert.equal(formatRecordedTime(0), '0:00');
    assert.equal(formatRecordedTime(7_900), '0:07');
    assert.equal(formatRecordedTime(754_000), '12:34');
    assert.equal(formatRecordedTime(3_600_000), '1:00:00');
    assert.equal(formatRecordedTime(4_503_000), '1:15:03');
    assert.equal(formatRecordedTime(null), '0:00');
    assert.equal(formatRecordedTime(Number.NaN), '0:00');
    assert.equal(formatRecordedTime(-5), '0:00');
  });

  test('"Recording · 12:34 · 85 MB", the numbers kept left-to-right after an Urdu label', () => {
    assert.equal(recordingLine('Recording', 754_000, '85 MB').replace(/‎/g, ''), 'Recording · 12:34 · 85 MB');
    assert.equal(recordingLine('Recording', 2_000, null).replace(/‎/g, ''), 'Recording · 0:02');
    assert.equal(recordingLine('ریکارڈنگ', 754_000, '85 MB'), 'ریکارڈنگ · ‎12:34‎ · ‎85 MB‎');
  });

  test('a maximum length of whole hours reads as hours', () => {
    const t = (key: string, params: { count: number }) =>
      key.endsWith('OneHour') ? 'one hour' : `${params.count} ${key.endsWith('Hours') ? 'h' : 'min'}`;
    assert.equal(maxLengthLabel(30, t), '30 min');
    assert.equal(maxLengthLabel(60, t), 'one hour', 'singular in Urdu');
    assert.equal(maxLengthLabel(120, t), '2 h');
    assert.equal(maxLengthLabel(90, t), '90 min');
    assert.equal(maxLengthLabel(480, t), '8 h');
  });
});
