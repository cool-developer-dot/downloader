/**
 * P18 Sleep timer & limits — rules and state:
 *
 * - #644 Sleep Timer: stop after 5–120 minutes, or at the end of this video. The sound fades out over its last 10 s
 *   (the native countdown, so it also works with the screen off). For this run only.
 * - #730 Playback Time Limit: a daily limit on watching (15 minutes to 3 hours), counted while a video plays and reset
 *   at local midnight. At the limit the video fades out and pauses, and doesn't play again today. App-wide (MMKV).
 *   With App Lock on, changing the limit or giving more time needs the App Lock PIN — so a child can't just turn it off.
 * - The timer and the limit share one countdown: whichever comes first.
 * - #712 Kid Lock: the Player locked for a child — every touch, Back, the volume keys and the tab bar do nothing;
 *   holding the lock for 3 s unlocks it. For this run only.
 */

import { mmkvKeys } from '@/storage/constants';
import { mmkvGetObject, mmkvSetObject } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';

// --- #644 ------------------------------------------------------------------------------------------------------

export const SLEEP_TIMER_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120] as const;
/** The sound fades out over the countdown's last 10 s. */
export const SLEEP_FADE_MS = 10_000;

export type SleepTimer =
  | { mode: 'off' }
  | { mode: 'minutes'; minutes: number; endsAt: number }
  | { mode: 'endOfVideo' };

const useSleepStore = createStore<{ timer: SleepTimer }>()(() => ({ timer: { mode: 'off' } }));

export function useSleepTimer(): SleepTimer {
  return useSleepStore((state) => state.timer);
}

export function getSleepTimer(): SleepTimer {
  return useSleepStore.getState().timer;
}

export function startSleepTimer(minutes: number, now = Date.now()): void {
  useSleepStore.setState({ timer: { mode: 'minutes', minutes, endsAt: now + minutes * 60_000 } });
}

export function sleepAtEndOfVideo(): void {
  useSleepStore.setState({ timer: { mode: 'endOfVideo' } });
}

export function cancelSleepTimer(): void {
  useSleepStore.setState({ timer: { mode: 'off' } });
}

/** For P5's end of playback: the video that ends now stops, whatever Repeat or Auto Play Next say. */
export function isSleepAtEndOfVideo(): boolean {
  return getSleepTimer().mode === 'endOfVideo';
}

/** Whole minutes left (at least 1 while it runs), or null when no minutes timer runs. */
export function sleepMinutesLeft(timer: SleepTimer, now = Date.now()): number | null {
  if (timer.mode !== 'minutes') {
    return null;
  }
  return Math.max(1, Math.ceil((timer.endsAt - now) / 60_000));
}

// --- #730 ------------------------------------------------------------------------------------------------------

export const DAILY_LIMIT_MINUTES = [15, 30, 45, 60, 90, 120, 180] as const;

/** `YYYY-MM-DD` in the phone's own time zone: the limit resets at local midnight. */
export function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export type LimitState = {
  /** Minutes a day; 0 = no limit. */
  dailyMinutes: number;
  /** Seconds watched on `day`. */
  usedSeconds: number;
  day: string;
};

export function normalizeLimitState(value: unknown, today: string): LimitState {
  const saved = value && typeof value === 'object' ? (value as Partial<Record<keyof LimitState, unknown>>) : {};
  const dailyMinutes = (DAILY_LIMIT_MINUTES as readonly unknown[]).includes(saved.dailyMinutes)
    ? (saved.dailyMinutes as number)
    : 0;
  const sameDay = saved.day === today;
  const used = typeof saved.usedSeconds === 'number' && Number.isFinite(saved.usedSeconds) ? saved.usedSeconds : 0;
  return { dailyMinutes, usedSeconds: sameDay ? Math.max(0, used) : 0, day: today };
}

/** Seconds of watching left today; null without a limit. A new day starts at 0 used. */
export function limitSecondsLeft(state: LimitState, today: string): number | null {
  if (state.dailyMinutes <= 0) {
    return null;
  }
  const used = state.day === today ? state.usedSeconds : 0;
  return Math.max(0, state.dailyMinutes * 60 - used);
}

/** The state after `seconds` more of watching, at `today` (a new day starts the count again). */
export function addWatched(state: LimitState, seconds: number, today: string): LimitState {
  const add = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const base = state.day === today ? state.usedSeconds : 0;
  return { ...state, day: today, usedSeconds: base + add };
}

function readLimit(): LimitState {
  const today = localDay(new Date());
  try {
    return normalizeLimitState(mmkvGetObject(mmkvKeys.playerDailyLimit), today);
  } catch {
    return { dailyMinutes: 0, usedSeconds: 0, day: today };
  }
}

const useLimitStore = createStore<LimitState>()(() => readLimit());

function saveLimit(next: LimitState): void {
  try {
    mmkvSetObject(mmkvKeys.playerDailyLimit, next);
  } catch {
    // Kept for this run even when it can't be saved.
  }
  useLimitStore.setState(next, true);
}

export function useLimitState(): LimitState {
  return useLimitStore((state) => state);
}

export function getLimitState(): LimitState {
  return useLimitStore.getState();
}

export function setDailyLimit(minutes: number): void {
  const current = getLimitState();
  saveLimit({ ...current, dailyMinutes: (DAILY_LIMIT_MINUTES as readonly number[]).includes(minutes) ? minutes : 0 });
}

export function recordWatched(seconds: number, now = new Date()): void {
  saveLimit(addWatched(getLimitState(), seconds, localDay(now)));
}

/** "More time" (with the parent's PIN when App Lock is on): today's count goes back by `minutes`. */
export function grantMoreTime(minutes: number, now = new Date()): void {
  const today = localDay(now);
  const state = getLimitState();
  const used = state.day === today ? state.usedSeconds : 0;
  saveLimit({ ...state, day: today, usedSeconds: Math.max(0, used - minutes * 60) });
}

// --- The shared countdown ---------------------------------------------------------------------------------------

/**
 * What the native countdown should be set to while a video plays: the sooner of the sleep timer and the day's limit
 * (ms from now), or null for no countdown. The end-of-video timer has no countdown (the video's end decides).
 */
export function nextDeadline(input: {
  timer: SleepTimer;
  limitSecondsLeft: number | null;
  now: number;
}): { inMs: number; reason: 'sleep' | 'limit' } | null {
  const candidates: { inMs: number; reason: 'sleep' | 'limit' }[] = [];
  if (input.timer.mode === 'minutes') {
    candidates.push({ inMs: Math.max(0, input.timer.endsAt - input.now), reason: 'sleep' });
  }
  if (input.limitSecondsLeft != null) {
    candidates.push({ inMs: Math.max(0, input.limitSecondsLeft * 1000), reason: 'limit' });
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((a, b) => (b.inMs < a.inMs ? b : a));
}

/** The countdown with the fade inside it: armed `fade` early, so the video is silent and paused right at the end. */
export function countdownStart(inMs: number, fadeMs = SLEEP_FADE_MS): { inMs: number; fadeMs: number } {
  const fade = Math.min(fadeMs, Math.max(0, inMs));
  return { inMs: Math.max(0, inMs - fade), fadeMs: fade };
}

// --- #712 ------------------------------------------------------------------------------------------------------

export const KID_LOCK_HOLD_MS = 3_000;

const useKidLockStore = createStore<{ on: boolean }>()(() => ({ on: false }));

export function useKidLock(): boolean {
  return useKidLockStore((state) => state.on);
}

export function getKidLock(): boolean {
  return useKidLockStore.getState().on;
}

export function setKidLock(on: boolean): void {
  useKidLockStore.setState({ on });
}

// --- Labels ------------------------------------------------------------------------------------------------------

/** "45 min", "1 h", "1 h 30 min" (minutes rounded up, so "1 min" is the least shown while time is left). */
export function formatDuration(
  t: (key: 'playerEngine.durationMinutes' | 'playerEngine.durationHours' | 'playerEngine.durationHoursMinutes', params: Record<string, number>) => string,
  totalMinutes: number,
): string {
  const minutes = Math.max(0, Math.ceil(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) {
    return t('playerEngine.durationMinutes', { m });
  }
  return m === 0 ? t('playerEngine.durationHours', { h }) : t('playerEngine.durationHoursMinutes', { h, m });
}

// --- #730: the "Daily limit reached" notice ------------------------------------------------------------------------

const useLimitNoticeStore = createStore<{ visible: boolean }>()(() => ({ visible: false }));

export function useLimitNotice(): boolean {
  return useLimitNoticeStore((state) => state.visible);
}

export function showLimitNotice(): void {
  useLimitNoticeStore.setState({ visible: true });
}

export function hideLimitNotice(): void {
  useLimitNoticeStore.setState({ visible: false });
}

/**
 * Whether the armed countdown must be set again: it is gone or new, or its end moved by more than `toleranceMs`. The
 * limit's time left falls as fast as the clock while a video plays, so its end stays put and the countdown (and a
 * fade under way) is left alone.
 */
export function shouldRearm(
  armed: { endsAt: number; reason: 'sleep' | 'limit' } | null,
  next: { endsAt: number; reason: 'sleep' | 'limit' } | null,
  toleranceMs = 1_500,
): boolean {
  if (!armed || !next) {
    return armed !== next;
  }
  return armed.reason !== next.reason || Math.abs(armed.endsAt - next.endsAt) > toleranceMs;
}
