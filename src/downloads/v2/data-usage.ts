/**
 * Data usage (H6): Daily (#416) and Monthly (#417) data downloaded by VidoraX, Total Count (#418) of completed
 * downloads and the Data Limit Alert (#422). Counted from the v2 engine's own events only. Pure.
 *
 * Counting rule — never double-count:
 * - Each download keeps a baseline: the last `bytesDone` already counted. Only `bytesDone − baseline` is added.
 * - The baseline is persisted, so a download resumed after a restart of the app is not counted again from zero.
 * - A download first seen through its state event starts at that record's `bytesDone` (a download resumed from an
 *   earlier version of the app counts only what it fetches from now on); a brand-new one starts at 0.
 * - A download first seen through a progress event, with no baseline, starts at that event's `bytesDone` (at most
 *   one progress tick is not counted — undercounting, never double-counting).
 * - `bytesDone` dropping below the baseline is a restart from zero: the bytes from 0 to the new value are new and
 *   are counted.
 * - Only `download`-phase progress counts (processing reads files already on the device).
 *
 * Buckets are the local calendar day (`YYYY-MM-DD`) and month (`YYYY-MM`) of the event.
 */

export const DATA_USAGE_VERSION = 1;
/** Daily buckets kept (enough for "last 30 days" and this month). */
const KEEP_DAYS = 62;
/** Monthly buckets kept. */
const KEEP_MONTHS = 24;
/** Baselines and completion ids remembered at most. */
const MAX_TRACKED = 300;

export type DataUsageState = {
  version: number;
  days: Record<string, number>;
  months: Record<string, number>;
  totalBytes: number;
  completedCount: number;
  /** id → last counted `bytesDone`, for downloads not finished yet. */
  baselines: Record<string, number>;
  /** Recently completed ids, so a repeated `completed` event counts once. */
  completedIds: string[];
  /** The day / month a limit alert was already shown for. */
  alertedDay: string | null;
  alertedMonth: string | null;
};

export const EMPTY_DATA_USAGE: DataUsageState = {
  version: DATA_USAGE_VERSION,
  days: {},
  months: {},
  totalBytes: 0,
  completedCount: 0,
  baselines: {},
  completedIds: [],
  alertedDay: null,
  alertedMonth: null,
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `YYYY-MM-DD`. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local `YYYY-MM`. */
export function monthKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function keepNewest(record: Record<string, number>, keep: number): Record<string, number> {
  const keys = Object.keys(record).sort();
  if (keys.length <= keep) {
    return record;
  }
  const next: Record<string, number> = {};
  for (const key of keys.slice(keys.length - keep)) {
    next[key] = record[key]!;
  }
  return next;
}

function boundBaselines(baselines: Record<string, number>): Record<string, number> {
  const keys = Object.keys(baselines);
  if (keys.length <= MAX_TRACKED) {
    return baselines;
  }
  const next: Record<string, number> = {};
  for (const key of keys.slice(keys.length - MAX_TRACKED)) {
    next[key] = baselines[key]!;
  }
  return next;
}

/** Pure: adds `bytes` to the buckets of `at`. */
export function addBytes(state: DataUsageState, bytes: number, at: number): DataUsageState {
  if (!(bytes > 0) || !Number.isFinite(bytes) || !Number.isFinite(at)) {
    return state;
  }
  const day = dayKey(at);
  const month = monthKey(at);
  return {
    ...state,
    days: keepNewest({ ...state.days, [day]: (state.days[day] ?? 0) + bytes }, KEEP_DAYS),
    months: keepNewest({ ...state.months, [month]: (state.months[month] ?? 0) + bytes }, KEEP_MONTHS),
    totalBytes: state.totalBytes + bytes,
  };
}

/** Pure: a `download`-phase progress event. */
export function applyProgressEvent(
  state: DataUsageState,
  event: { id: string; phase: 'download' | 'processing'; bytesDone: number },
  at: number,
): DataUsageState {
  const bytes = finite(event.bytesDone);
  if (event.phase !== 'download' || bytes == null || !event.id) {
    return state;
  }
  const baseline = state.baselines[event.id];
  if (baseline == null) {
    // First sight without a baseline: start from here (never count bytes that may have been counted before).
    return { ...state, baselines: boundBaselines({ ...state.baselines, [event.id]: bytes }) };
  }
  // A drop is a restart from zero: everything up to `bytes` is new.
  const delta = bytes >= baseline ? bytes - baseline : bytes;
  const counted = addBytes(state, delta, at);
  return { ...counted, baselines: { ...counted.baselines, [event.id]: bytes } };
}

/** Pure: a state event. Sets the baseline of a download seen for the first time; counts a completion once. */
export function applyStateEvent(
  state: DataUsageState,
  record: { id: string; state: string; bytesDone: number },
): DataUsageState {
  if (!record.id) {
    return state;
  }
  if (record.state === 'completed') {
    const { [record.id]: _done, ...baselines } = state.baselines;
    if (state.completedIds.includes(record.id)) {
      return { ...state, baselines };
    }
    return {
      ...state,
      baselines,
      completedCount: state.completedCount + 1,
      completedIds: [...state.completedIds, record.id].slice(-MAX_TRACKED),
    };
  }
  if (record.state === 'failed' || record.state === 'cancelled') {
    const { [record.id]: _gone, ...baselines } = state.baselines;
    return { ...state, baselines };
  }
  if (state.baselines[record.id] == null) {
    const bytes = finite(record.bytesDone) ?? 0;
    return { ...state, baselines: boundBaselines({ ...state.baselines, [record.id]: bytes }) };
  }
  return state;
}

export type DataUsageSummary = {
  todayBytes: number;
  monthBytes: number;
  last30DaysBytes: number;
  totalBytes: number;
  completedCount: number;
};

/** Pure: the figures the Data usage screen shows, for the local day of `now`. */
export function summarizeDataUsage(state: DataUsageState, now: number): DataUsageSummary {
  const today = dayKey(now);
  let last30 = 0;
  for (let i = 0; i < 30; i += 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    last30 += state.days[dayKey(date.getTime())] ?? 0;
  }
  return {
    todayBytes: state.days[today] ?? 0,
    monthBytes: state.months[monthKey(now)] ?? 0,
    last30DaysBytes: last30,
    totalBytes: state.totalBytes,
    completedCount: state.completedCount,
  };
}

/** Pure: counters back to zero; baselines and completion ids are kept so nothing is counted twice afterwards. */
export function resetCounters(state: DataUsageState): DataUsageState {
  return {
    ...state,
    days: {},
    months: {},
    totalBytes: 0,
    completedCount: 0,
    alertedDay: null,
    alertedMonth: null,
  };
}

export type DataLimitAlert = { period: 'day' | 'month'; usedBytes: number; limitBytes: number };

/**
 * Pure: limits in MB (0 = off). Returns the alerts to show now — each period at most once — and the state that
 * remembers them. Alerts never stop a download.
 */
export function checkDataLimits(
  state: DataUsageState,
  limits: { dailyMb: number; monthlyMb: number },
  now: number,
): { state: DataUsageState; alerts: DataLimitAlert[] } {
  const alerts: DataLimitAlert[] = [];
  let next = state;
  const day = dayKey(now);
  const month = monthKey(now);
  const daily = mbToBytes(limits.dailyMb);
  const monthly = mbToBytes(limits.monthlyMb);
  const usedDay = state.days[day] ?? 0;
  const usedMonth = state.months[month] ?? 0;
  if (daily > 0 && usedDay >= daily && state.alertedDay !== day) {
    alerts.push({ period: 'day', usedBytes: usedDay, limitBytes: daily });
    next = { ...next, alertedDay: day };
  }
  if (monthly > 0 && usedMonth >= monthly && state.alertedMonth !== month) {
    alerts.push({ period: 'month', usedBytes: usedMonth, limitBytes: monthly });
    next = { ...next, alertedMonth: month };
  }
  return { state: next, alerts };
}

export function mbToBytes(mb: number): number {
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb) * 1024 * 1024 : 0;
}

/** Pure: a stored value back into a state, or an empty state when it is not one. */
export function parseDataUsage(raw: string | null | undefined): DataUsageState {
  if (!raw) {
    return EMPTY_DATA_USAGE;
  }
  try {
    const data = JSON.parse(raw) as Partial<DataUsageState>;
    if (!data || data.version !== DATA_USAGE_VERSION) {
      return EMPTY_DATA_USAGE;
    }
    const numbers = (value: unknown): Record<string, number> => {
      const out: Record<string, number> = {};
      if (value && typeof value === 'object') {
        for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
          const v = finite(n);
          if (v != null) {
            out[key] = v;
          }
        }
      }
      return out;
    };
    return {
      version: DATA_USAGE_VERSION,
      days: numbers(data.days),
      months: numbers(data.months),
      totalBytes: finite(data.totalBytes) ?? 0,
      completedCount: finite(data.completedCount) ?? 0,
      baselines: numbers(data.baselines),
      completedIds: Array.isArray(data.completedIds) ? data.completedIds.filter((id) => typeof id === 'string') : [],
      alertedDay: typeof data.alertedDay === 'string' ? data.alertedDay : null,
      alertedMonth: typeof data.alertedMonth === 'string' ? data.alertedMonth : null,
    };
  } catch {
    return EMPTY_DATA_USAGE;
  }
}

/** Limits in MB from settings: whole, non-negative, at most 10 TB. */
export function normalizeLimitMb(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(10 * 1024 * 1024, Math.round(value));
}
