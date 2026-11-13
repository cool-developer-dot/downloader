import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_DURATION_LABEL_MODE,
  formatDurationLabel,
  isDurationLabelMode,
  toggleDurationLabelMode,
} from './duration-label.ts';

const MINUS = '−';

describe('formatDurationLabel', () => {
  it('shows the total length by default', () => {
    assert.equal(DEFAULT_DURATION_LABEL_MODE, 'total');
    assert.equal(formatDurationLabel(12, 634.6, 'total'), '10:34');
  });

  it('shows the time left with a minus sign', () => {
    assert.equal(formatDurationLabel(5, 10, 'remaining'), `${MINUS}00:05`);
    assert.equal(formatDurationLabel(0, 3723, 'remaining'), `${MINUS}1:02:03`);
    assert.equal(formatDurationLabel(60, 3783, 'remaining'), `${MINUS}1:02:03`);
  });

  it('adds up with the position label to the total shown', () => {
    // 4.4 s played of 10 s: the left label shows 00:04, so 00:06 is left.
    assert.equal(formatDurationLabel(4.4, 10, 'remaining'), `${MINUS}00:06`);
    assert.equal(formatDurationLabel(4, 10, 'remaining'), `${MINUS}00:06`);
    // A fractional length (634.63 s, shown as 10:34): 05:42 played → 04:52 left (not 04:53).
    assert.equal(formatDurationLabel(634.633, 634.633, 'total'), '10:34');
    assert.equal(formatDurationLabel(342.9, 634.633, 'remaining'), `${MINUS}04:52`);
    assert.equal(formatDurationLabel(0.2, 634.633, 'remaining'), `${MINUS}10:34`);
  });

  it('never goes below zero at or past the end', () => {
    assert.equal(formatDurationLabel(10, 10, 'remaining'), `${MINUS}00:00`);
    assert.equal(formatDurationLabel(12, 10, 'remaining'), `${MINUS}00:00`);
  });

  it('shows the unknown time when the duration is unknown, in both modes', () => {
    for (const duration of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatDurationLabel(5, duration, 'remaining'), '--:--', String(duration));
      assert.equal(formatDurationLabel(5, duration, 'total'), '--:--', String(duration));
    }
  });

  it('treats a missing position as the start', () => {
    assert.equal(formatDurationLabel(Number.NaN, 10, 'remaining'), `${MINUS}00:10`);
  });
});

describe('duration label mode', () => {
  it('toggles total ↔ remaining', () => {
    assert.equal(toggleDurationLabelMode('total'), 'remaining');
    assert.equal(toggleDurationLabelMode('remaining'), 'total');
  });

  it('accepts only the two stored values', () => {
    assert.equal(isDurationLabelMode('total'), true);
    assert.equal(isDurationLabelMode('remaining'), true);
    for (const value of ['', 'elapsed', null, undefined, 1]) {
      assert.equal(isDurationLabelMode(value), false);
    }
  });
});
