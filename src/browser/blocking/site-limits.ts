/**
 * B14 #276 / #277 / #278 — the user's own site blocking, as pure rules over one state object (loaded from the browser
 * profile's database by `site-blocking.service.ts`):
 *
 * - **Site blocker (#276):** a site on the list never opens: "This site is blocked".
 * - **Site time limit (#277):** minutes per day for a site; time counts while one of its pages is on screen in the
 *   browser. Once used up the site is blocked until local midnight. Each day starts at zero.
 * - **Focus mode (#278):** until `focusEndsAt`, the sites on the distracting list are blocked.
 *
 * A site covers its subdomains (`siteCovers`); the main page is what's blocked, decided by the app before it loads —
 * never by the native request hook.
 */
import { hostOf, matchingSite } from './blocking-settings';

export const MAX_BLOCKED_SITES = 300;
export const MAX_TIME_LIMITS = 100;
export const MAX_FOCUS_SITES = 300;

/** Daily limits offered, in minutes. */
export const TIME_LIMIT_MINUTES = [1, 5, 10, 15, 30, 45, 60, 90, 120, 180] as const;
/** Focus timers offered, in minutes (25 = the usual "pomodoro"). */
export const FOCUS_MINUTES = [1, 5, 15, 25, 45, 60, 90, 120] as const;
export const DEFAULT_FOCUS_MINUTES = 25;
/** The same, as the `focusMinutes` setting stores them (a choice, like every browser choice setting). */
export const FOCUS_MINUTE_CHOICES = ['1', '5', '15', '25', '45', '60', '90', '120'] as const;
export type FocusMinutes = (typeof FOCUS_MINUTE_CHOICES)[number];
export const DEFAULT_FOCUS_MINUTES_CHOICE: FocusMinutes = '25';

export function normalizeFocusMinutesChoice(value: unknown): FocusMinutes {
  const text = typeof value === 'number' ? String(value) : value;
  return (FOCUS_MINUTE_CHOICES as readonly unknown[]).includes(text) ? (text as FocusMinutes) : DEFAULT_FOCUS_MINUTES_CHOICE;
}

export type SiteLimitsState = {
  blockedSites: readonly string[];
  /** site → minutes per day. */
  timeLimits: Readonly<Record<string, number>>;
  /** The local day `usage` belongs to (`localDayKey`). */
  usageDay: string;
  /** site → seconds used on `usageDay`. */
  usage: Readonly<Record<string, number>>;
  focusSites: readonly string[];
  /** Epoch ms when focus mode ends; null = off. */
  focusEndsAt: number | null;
};

export const EMPTY_SITE_LIMITS: SiteLimitsState = {
  blockedSites: [],
  timeLimits: {},
  usageDay: '',
  usage: {},
  focusSites: [],
  focusEndsAt: null,
};

export type SiteBlockReason =
  | { kind: 'blocked'; site: string }
  | { kind: 'time-limit'; site: string; minutes: number; until: number }
  | { kind: 'focus'; site: string; until: number };

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** The phone's local date, `YYYY-MM-DD`. */
export function localDayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The next local midnight after `now` (epoch ms). */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

export function normalizeTimeLimit(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 24 * 60 ? n : null;
}

export function normalizeFocusMinutes(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return (FOCUS_MINUTES as readonly unknown[]).includes(n) ? (n as number) : DEFAULT_FOCUS_MINUTES;
}

export function isFocusActive(state: SiteLimitsState, now: number): boolean {
  return state.focusEndsAt != null && state.focusEndsAt > now;
}

/** Seconds used today on `site` (0 when the stored usage is for another day). */
export function usedSeconds(state: SiteLimitsState, site: string, now: number): number {
  if (state.usageDay !== localDayKey(now)) return 0;
  return Math.max(0, state.usage[site] ?? 0);
}

/** Why `url` may not open now, or null. Order: the site blocker, focus mode, the daily limit. */
export function siteBlockReason(url: string | null | undefined, state: SiteLimitsState, now: number): SiteBlockReason | null {
  if (!hostOf(url)) return null;
  const blocked = matchingSite(url, state.blockedSites);
  if (blocked) return { kind: 'blocked', site: blocked };
  if (isFocusActive(state, now)) {
    const focus = matchingSite(url, state.focusSites);
    if (focus) return { kind: 'focus', site: focus, until: state.focusEndsAt as number };
  }
  const limited = matchingSite(url, Object.keys(state.timeLimits));
  if (limited) {
    const minutes = state.timeLimits[limited];
    if (usedSeconds(state, limited, now) >= minutes * 60) {
      return { kind: 'time-limit', site: limited, minutes, until: nextLocalMidnight(now) };
    }
  }
  return null;
}

/** The time-limited site whose clock runs while `url` is on screen, or null. */
export function timedSiteFor(url: string | null | undefined, state: SiteLimitsState): string | null {
  return matchingSite(url, Object.keys(state.timeLimits));
}

/** `state` with `seconds` more on `site` today (a new day starts from zero). */
export function withUsage(state: SiteLimitsState, site: string, seconds: number, now: number): SiteLimitsState {
  const add = Math.max(0, Math.round(seconds));
  const day = localDayKey(now);
  const base = state.usageDay === day ? state.usage : {};
  return { ...state, usageDay: day, usage: { ...base, [site]: (base[site] ?? 0) + add } };
}

/**
 * The seconds of on-screen time to count since the last tick: the gap, but never more than `maxGapMs` (a long gap
 * means the app was asleep or in the background in between, which must not count) and never negative (clock changes).
 */
export function tickSeconds(lastTick: number | null, now: number, maxGapMs: number): number {
  if (lastTick == null) return 0;
  const gap = now - lastTick;
  if (!(gap > 0)) return 0;
  return Math.min(gap, maxGapMs) / 1000;
}

/** When the state next changes by itself (focus ends, midnight for a used-up limit), so blocked tabs can reopen. */
export function nextChangeAt(state: SiteLimitsState, now: number): number | null {
  const times: number[] = [];
  if (isFocusActive(state, now)) times.push(state.focusEndsAt as number);
  const anyUsedUp = Object.keys(state.timeLimits).some((site) => usedSeconds(state, site, now) >= state.timeLimits[site] * 60);
  if (anyUsedUp) times.push(nextLocalMidnight(now));
  return times.length ? Math.min(...times) : null;
}
