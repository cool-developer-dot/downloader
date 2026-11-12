/**
 * F3 — scheduling and conditions, the pure part: the daily download hours as the settings keep them, their engine
 * form, time steppers, and the labels a waiting download shows ("Scheduled for 02:00", "Waiting for charging"…).
 * The engine decides and enforces; this only shapes and words it.
 */

import type { DownloadWaitReason, DownloadWindow } from '@modules/vidorax-media/src/VidoraMedia.types';

export const MINUTES_PER_DAY = 24 * 60;
/** The time steppers move in quarter hours. */
export const TIME_STEP_MINUTES = 15;
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Settings → Download Settings → "Download hours" (off by default; 01:00–06:00 every day when first turned on). */
export type DownloadHours = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  days: number[];
};

export const DEFAULT_DOWNLOAD_HOURS: DownloadHours = {
  enabled: false,
  startMinute: 60,
  endMinute: 6 * 60,
  days: [...ALL_DAYS],
};

function minuteOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MINUTES_PER_DAY ? value : fallback;
}

/** A stored value → valid download hours (anything unreadable → the default; no days left → every day). */
export function normalizeDownloadHours(raw: unknown): DownloadHours {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_DOWNLOAD_HOURS, days: [...DEFAULT_DOWNLOAD_HOURS.days] };
  }
  const value = raw as Partial<DownloadHours>;
  const days = Array.isArray(value.days)
    ? [...new Set(value.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b)
    : [];
  return {
    enabled: value.enabled === true,
    startMinute: minuteOrDefault(value.startMinute, DEFAULT_DOWNLOAD_HOURS.startMinute),
    endMinute: minuteOrDefault(value.endMinute, DEFAULT_DOWNLOAD_HOURS.endMinute),
    days: days.length > 0 ? days : [...ALL_DAYS],
  };
}

/** The engine's form: null when the hours are off. */
export function downloadWindowForEngine(hours: DownloadHours | null | undefined): DownloadWindow | null {
  if (!hours?.enabled) {
    return null;
  }
  const normalized = normalizeDownloadHours(hours);
  return { startMinute: normalized.startMinute, endMinute: normalized.endMinute, days: normalized.days };
}

export function sameDownloadWindow(a: DownloadWindow | null | undefined, b: DownloadWindow | null | undefined): boolean {
  if (!a || !b) {
    return !a && !b;
  }
  return (
    a.startMinute === b.startMinute &&
    a.endMinute === b.endMinute &&
    a.days.length === b.days.length &&
    a.days.every((day, i) => day === b.days[i])
  );
}

/** "HH:mm", 24-hour. */
export function formatMinuteOfDay(minute: number): string {
  const safe = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** One quarter-hour step forward or back, wrapping around midnight. */
export function stepMinuteOfDay(minute: number, direction: 1 | -1, step = TIME_STEP_MINUTES): number {
  const snapped = Math.round(minute / step) * step;
  return (((snapped + direction * step) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** Toggles a weekday, never leaving the window with no day at all. */
export function toggleDay(days: readonly number[], day: number): number[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return next.length > 0 ? [...next].sort((a, b) => a - b) : [...days];
}

const WEEKDAYS: Record<'en' | 'ur', string[]> = {
  // Indexed by ISO weekday - 1 (Monday first).
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ur: ['پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ', 'اتوار'],
};

export function weekdayName(isoDay: number, language: string): string {
  return WEEKDAYS[language === 'ur' ? 'ur' : 'en'][(isoDay - 1 + 7) % 7] ?? '';
}

function isoDayOf(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

/** "02:00" when it is today, else "Tue 02:00" — like the notification, 24-hour and Latin digits. */
export function formatWhen(at: number, now: number, language: string): string {
  const date = new Date(at);
  const today = new Date(now);
  const time = formatMinuteOfDay(date.getHours() * 60 + date.getMinutes());
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay ? time : `${weekdayName(isoDayOf(date), language)} ${time}`;
}

/** Translation keys of the wait labels (localization/en.ts `downloads.wait*`). */
export const WAIT_LABEL_KEYS = {
  scheduled: 'downloads.waitScheduled',
  scheduledNoTime: 'downloads.waitScheduledNoTime',
  outside_hours: 'downloads.waitOutsideHours',
  roaming: 'downloads.waitRoaming',
  charging: 'downloads.waitCharging',
  battery_low: 'downloads.waitBatteryLow',
} as const;

/**
 * The label a waiting download shows in the list, its details and (natively) its notification. `translate` is the
 * app's translator, passed in to keep this pure.
 */
export function waitLabel(
  reason: DownloadWaitReason | null | undefined,
  until: number | null | undefined,
  now: number,
  language: string,
  translate: (key: string, params?: Record<string, string>) => string,
): string | null {
  switch (reason) {
    case 'scheduled':
      return until != null
        ? translate(WAIT_LABEL_KEYS.scheduled, { time: formatWhen(until, now, language) })
        : translate(WAIT_LABEL_KEYS.scheduledNoTime);
    case 'outside_hours':
      return translate(WAIT_LABEL_KEYS.outside_hours);
    case 'roaming':
      return translate(WAIT_LABEL_KEYS.roaming);
    case 'charging':
      return translate(WAIT_LABEL_KEYS.charging);
    case 'battery_low':
      return translate(WAIT_LABEL_KEYS.battery_low);
    default:
      return null;
  }
}

/** "Start at…": today or tomorrow at a minute of the day; a time already past today means tomorrow. */
export function startAtFrom(day: 'today' | 'tomorrow', minuteOfDay: number, now: number): number {
  const date = new Date(now);
  date.setHours(Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  if (day === 'tomorrow' || date.getTime() <= now) {
    date.setDate(date.getDate() + 1);
  }
  return date.getTime();
}
