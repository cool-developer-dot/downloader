/**
 * B18 #185 — data used while browsing. Pure.
 *
 * The browser counts in intervals: one starts when the browser comes to the front (app active, Browser route shown)
 * and ends when it leaves. At both ends it reads the app's network bytes (VidoraWeb `getAppTraffic`, TrafficStats)
 * and the download engine's own count (H6 Data usage, read only). Browsing = app bytes − downloaded bytes in that
 * interval. **Never overcount**: an interval is dropped when the phone restarted (boot count or time since boot), a
 * counter went down, or the download count went down (its Reset). The open interval lives in memory only: after the
 * app is killed, the gap is never counted (downloads may have run without the app seeing them).
 *
 * Buckets: the local day and month the interval ended in (same keys as H6).
 */
import { dayKey, monthKey } from '@/downloads/v2/data-usage';

export type TrafficMark = {
  rxBytes: number;
  txBytes: number;
  bootCount: number;
  sinceBootMs: number;
  /** H6's downloaded total at the same moment. */
  downloadedBytes: number;
};

/** One interval's browsing bytes, or null when it can't be counted safely. */
export function intervalBrowsingBytes(start: TrafficMark, end: TrafficMark): number | null {
  const fields = [start.rxBytes, start.txBytes, end.rxBytes, end.txBytes, start.downloadedBytes, end.downloadedBytes];
  if (!fields.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return null;
  if (start.bootCount !== end.bootCount) return null;
  if (end.sinceBootMs < start.sinceBootMs) return null;
  if (end.rxBytes < start.rxBytes || end.txBytes < start.txBytes) return null;
  if (end.downloadedBytes < start.downloadedBytes) return null;
  const app = end.rxBytes - start.rxBytes + (end.txBytes - start.txBytes);
  const downloads = end.downloadedBytes - start.downloadedBytes;
  return Math.max(0, app - downloads);
}

export const BROWSING_TRAFFIC_VERSION = 1;
const KEEP_DAYS = 62;
const KEEP_MONTHS = 24;

export type BrowsingTrafficState = {
  version: number;
  days: Record<string, number>;
  months: Record<string, number>;
};

export const EMPTY_BROWSING_TRAFFIC: BrowsingTrafficState = { version: BROWSING_TRAFFIC_VERSION, days: {}, months: {} };

function keepNewest(record: Record<string, number>, keep: number): Record<string, number> {
  const keys = Object.keys(record).sort();
  if (keys.length <= keep) return record;
  const next: Record<string, number> = {};
  for (const key of keys.slice(keys.length - keep)) next[key] = record[key]!;
  return next;
}

export function addBrowsingBytes(state: BrowsingTrafficState, bytes: number, at: number): BrowsingTrafficState {
  if (!(bytes > 0) || !Number.isFinite(bytes) || !Number.isFinite(at)) return state;
  const day = dayKey(at);
  const month = monthKey(at);
  return {
    ...state,
    days: keepNewest({ ...state.days, [day]: (state.days[day] ?? 0) + bytes }, KEEP_DAYS),
    months: keepNewest({ ...state.months, [month]: (state.months[month] ?? 0) + bytes }, KEEP_MONTHS),
  };
}

function cleanBuckets(value: unknown, pattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, bytes] of Object.entries(value as Record<string, unknown>)) {
    if (pattern.test(key) && typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0) out[key] = bytes;
  }
  return out;
}

export function parseBrowsingTraffic(raw: string | null | undefined): BrowsingTrafficState {
  if (!raw) return EMPTY_BROWSING_TRAFFIC;
  try {
    const parsed = JSON.parse(raw) as Partial<BrowsingTrafficState>;
    return {
      version: BROWSING_TRAFFIC_VERSION,
      days: keepNewest(cleanBuckets(parsed.days, /^\d{4}-\d{2}-\d{2}$/), KEEP_DAYS),
      months: keepNewest(cleanBuckets(parsed.months, /^\d{4}-\d{2}$/), KEEP_MONTHS),
    };
  } catch {
    return EMPTY_BROWSING_TRAFFIC;
  }
}

export function summarizeBrowsing(state: BrowsingTrafficState, now: number): { todayBytes: number; monthBytes: number } {
  return { todayBytes: state.days[dayKey(now)] ?? 0, monthBytes: state.months[monthKey(now)] ?? 0 };
}
