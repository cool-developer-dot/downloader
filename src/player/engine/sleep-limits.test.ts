import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addWatched,
  cancelSleepTimer,
  countdownStart,
  formatDuration,
  getKidLock,
  getLimitState,
  getSleepTimer,
  grantMoreTime,
  isSleepAtEndOfVideo,
  limitSecondsLeft,
  localDay,
  nextDeadline,
  normalizeLimitState,
  recordWatched,
  setDailyLimit,
  setKidLock,
  shouldRearm,
  sleepAtEndOfVideo,
  sleepMinutesLeft,
  startSleepTimer,
} from './sleep-limits.ts';

const t = ((key: string, params: Record<string, number>) =>
  key.endsWith('Minutes') && !key.endsWith('HoursMinutes')
    ? `${params.m} min`
    : key.endsWith('HoursMinutes')
      ? `${params.h} h ${params.m} min`
      : `${params.h} h`) as Parameters<typeof formatDuration>[0];

describe('P18 sleep timer, daily limit, kid lock', () => {
  it('#644 counts whole minutes down and stops at the end of the video when asked', () => {
    startSleepTimer(30, 1_000);
    assert.equal(sleepMinutesLeft(getSleepTimer(), 1_000), 30);
    assert.equal(sleepMinutesLeft(getSleepTimer(), 1_000 + 29 * 60_000 + 1), 1);
    assert.equal(sleepMinutesLeft(getSleepTimer(), 1_000 + 40 * 60_000), 1);
    sleepAtEndOfVideo();
    assert.equal(isSleepAtEndOfVideo(), true);
    assert.equal(sleepMinutesLeft(getSleepTimer()), null);
    cancelSleepTimer();
    assert.equal(isSleepAtEndOfVideo(), false);
  });

  it('#730 counts per local day and starts again at midnight', () => {
    const day = localDay(new Date(2026, 10, 23, 23, 59));
    assert.equal(day, '2026-11-23');
    assert.equal(localDay(new Date(2026, 10, 24, 0, 1)), '2026-11-24');
    const state = { dailyMinutes: 30, usedSeconds: 600, day };
    assert.equal(limitSecondsLeft(state, day), 1200);
    assert.equal(limitSecondsLeft(state, '2026-11-24'), 1800);
    assert.equal(limitSecondsLeft({ ...state, dailyMinutes: 0 }, day), null);
    assert.equal(limitSecondsLeft({ ...state, usedSeconds: 5000 }, day), 0);
    assert.deepEqual(addWatched(state, 30, day), { dailyMinutes: 30, usedSeconds: 630, day });
    assert.deepEqual(addWatched(state, 30, '2026-11-24'), { dailyMinutes: 30, usedSeconds: 30, day: '2026-11-24' });
    assert.deepEqual(addWatched(state, -5, day), state);
  });

  it('#730 reads saved state defensively', () => {
    assert.deepEqual(normalizeLimitState({ dailyMinutes: 45, usedSeconds: 100, day: 'd1' }, 'd1'), {
      dailyMinutes: 45,
      usedSeconds: 100,
      day: 'd1',
    });
    assert.deepEqual(normalizeLimitState({ dailyMinutes: 33, usedSeconds: 'x', day: 'd0' }, 'd1'), {
      dailyMinutes: 0,
      usedSeconds: 0,
      day: 'd1',
    });
  });

  it('#730 records watching, and more time takes it back', () => {
    setDailyLimit(30);
    const now = new Date(2026, 10, 23, 12, 0);
    recordWatched(25 * 60, now);
    assert.equal(limitSecondsLeft(getLimitState(), localDay(now)), 300);
    grantMoreTime(15, now);
    assert.equal(limitSecondsLeft(getLimitState(), localDay(now)), 1200);
    setDailyLimit(7);
    assert.equal(getLimitState().dailyMinutes, 0);
  });

  it('shares one countdown: the sooner of the timer and the limit', () => {
    const timer = { mode: 'minutes' as const, minutes: 10, endsAt: 600_000 };
    assert.deepEqual(nextDeadline({ timer, limitSecondsLeft: 300, now: 0 }), { inMs: 300_000, reason: 'limit' });
    assert.deepEqual(nextDeadline({ timer, limitSecondsLeft: 900, now: 0 }), { inMs: 600_000, reason: 'sleep' });
    assert.deepEqual(nextDeadline({ timer: { mode: 'endOfVideo' }, limitSecondsLeft: null, now: 0 }), null);
    assert.deepEqual(nextDeadline({ timer: { mode: 'off' }, limitSecondsLeft: 0, now: 5 }), { inMs: 0, reason: 'limit' });
    // The fade sits inside the countdown: armed 10 s early, so the video is silent and paused right at the end.
    assert.deepEqual(countdownStart(60_000), { inMs: 50_000, fadeMs: 10_000 });
    assert.deepEqual(countdownStart(4_000), { inMs: 0, fadeMs: 4_000 });
  });

  it('sets the countdown again only when its end moves', () => {
    const limitAt = { endsAt: 100_000, reason: 'limit' as const };
    // Today's count moved the time left by as much as the clock: same end, a fade under way is left alone.
    assert.equal(shouldRearm(limitAt, { endsAt: 100_400, reason: 'limit' }), false);
    assert.equal(shouldRearm(limitAt, { endsAt: 115_000, reason: 'limit' }), true);
    assert.equal(shouldRearm(limitAt, { endsAt: 100_000, reason: 'sleep' }), true);
    assert.equal(shouldRearm(limitAt, null), true);
    assert.equal(shouldRearm(null, null), false);
    assert.equal(shouldRearm(null, limitAt), true);
  });

  it('labels durations', () => {
    assert.equal(formatDuration(t, 45), '45 min');
    assert.equal(formatDuration(t, 60), '1 h');
    assert.equal(formatDuration(t, 90), '1 h 30 min');
    assert.equal(formatDuration(t, 0.2), '1 min');
  });

  it('#712 Kid Lock is for this run', () => {
    assert.equal(getKidLock(), false);
    setKidLock(true);
    assert.equal(getKidLock(), true);
    setKidLock(false);
  });
});
