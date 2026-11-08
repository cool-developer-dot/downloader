import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { loadUrlForTab } from '@/browser/services/active-tab-navigation.service';
import { useBrowserStore } from '@/browser/stores';
import { isBrowserRouteVisible } from '@/browser/webview/webview-activity';
import { siteBlockingRepository, type SiteListName } from '@/storage/repositories/site-blocking.repository';
import { subscribeActiveProfile } from '@/storage/profile/active-profile';

import {
  EMPTY_SITE_LIMITS,
  MAX_BLOCKED_SITES,
  MAX_FOCUS_SITES,
  MAX_TIME_LIMITS,
  isFocusActive,
  localDayKey,
  nextChangeAt,
  siteBlockReason,
  tickSeconds,
  timedSiteFor,
  withUsage,
  type SiteBlockReason,
  type SiteLimitsState,
} from './site-limits';

/**
 * B14 #276 / #277 / #278 — the user's site blocker, daily time limits and focus mode for the browser profile in use.
 *
 * - The state lives in the profile's database (survives restarts) and in memory here; a profile switch loads the
 *   other profile's.
 * - `siteBlockReasonFor(url)` is what the browser asks before a page opens (`loadUrl`, the request guard, load start).
 * - Time counts while a time-limited site is on screen in the browser (app in front, Browser route shown, the tab not
 *   showing a block) — a tick every 15 s, saved as whole seconds.
 * - When the state changes (a limit used up, focus starting or ending, a list edited, midnight), every open tab is
 *   checked: one on a now-blocked site shows "This site is blocked"; one showing a block that no longer applies opens
 *   its page again.
 */

const TICK_MS = 15_000;
const MAX_TICK_GAP_MS = 20_000;

let state: SiteLimitsState = EMPTY_SITE_LIMITS;
let loaded = false;
let version = 0;
const listeners = new Set<() => void>();
let changeTimer: ReturnType<typeof setTimeout> | null = null;

/** The time the screens show remaining / used time for (refreshed on every change, and every 30 s while shown). */
let clockNow = Date.now();

function emit(): void {
  clockNow = Date.now();
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Why `url` may not open now (null until the profile's lists have loaded, and for allowed pages). */
export function siteBlockReasonFor(url: string | null | undefined, now: number = Date.now()): SiteBlockReason | null {
  if (!loaded) return null;
  return siteBlockReason(url, state, now);
}

export function getSiteLimits(): SiteLimitsState {
  return state;
}

/** The state now; re-renders on every change (and once a minute for the focus countdown, see `useSiteLimitsClock`). */
export function useSiteLimits(): SiteLimitsState {
  useSyncExternalStore(subscribe, () => version, () => version);
  return state;
}

function subscribeClock(listener: () => void): () => void {
  const unsubscribe = subscribe(listener);
  const timer = setInterval(() => {
    clockNow = Date.now();
    listener();
  }, 30_000);
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}

/** "Now" for rendering (focus on / off, time used), without reading the clock during render. */
export function useSiteClock(): number {
  return useSyncExternalStore(subscribeClock, () => clockNow, () => clockNow);
}

function setState(next: SiteLimitsState): void {
  state = next;
  emit();
  enforce();
}

/** Checks every open tab against the current state, and plans the next check. */
export function enforce(now: number = Date.now()): void {
  if (!loaded) return;
  for (const tab of useBrowserStore.getState().tabs) {
    const reason = siteBlockReason(tab.url, state, now);
    const showsBlock = tab.error?.code === 'site_blocked';
    if (reason && !showsBlock) {
      loadUrlForTab(tab.id, tab.url);
    } else if (!reason && showsBlock) {
      const target = tab.error?.retryUrl ?? tab.url;
      if (target) loadUrlForTab(tab.id, target);
    }
  }
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = null;
  const at = nextChangeAt(state, now);
  if (at != null) {
    // A little after the change; capped so a long wait can't overflow the timer.
    changeTimer = setTimeout(() => setState({ ...state }), Math.min(Math.max(0, at - now) + 500, 6 * 60 * 60_000));
  }
}

async function reload(): Promise<void> {
  const day = localDayKey(Date.now());
  try {
    const next = await siteBlockingRepository.load(day);
    loaded = true;
    setState(next);
    tick();
    void siteBlockingRepository.pruneTimeUsedBefore(day).catch(() => undefined);
  } catch {
    // Unreadable: nothing is blocked rather than everything.
    loaded = true;
    setState(EMPTY_SITE_LIMITS);
  }
}

// ---- time counting ----

let lastTick: number | null = null;
/** The site on screen since `lastTick` (the interval is counted for it, not for what is on screen now). */
let lastSite: string | null = null;
const pendingSeconds = new Map<string, number>();

function countingSite(): string | null {
  if (!loaded || AppState.currentState !== 'active' || !isBrowserRouteVisible()) return null;
  const browser = useBrowserStore.getState();
  const tab = browser.tabs.find((t) => t.id === browser.activeTabId);
  if (!tab || tab.error) return null;
  return timedSiteFor(tab.url, state);
}

/** Counts the time since the last tick for the site that was on screen, then notes what is on screen now. */
function tick(now: number = Date.now()): void {
  const site = lastSite;
  const seconds = site ? tickSeconds(lastTick, now, MAX_TICK_GAP_MS) : 0;
  lastSite = countingSite();
  lastTick = lastSite ? now : null;
  if (!site || seconds <= 0) return;
  const total = (pendingSeconds.get(site) ?? 0) + seconds;
  const whole = Math.floor(total);
  pendingSeconds.set(site, total - whole);
  if (whole <= 0) return;
  const probe = `https://${site}/`;
  const before = siteBlockReason(probe, state, now);
  state = withUsage(state, site, whole, now);
  void siteBlockingRepository.addTimeUsed(localDayKey(now), site, whole).catch(() => undefined);
  emit();
  if (!before && siteBlockReason(probe, state, now)) enforce(now);
}

function stopClock(): void {
  tick();
  lastSite = null;
  lastTick = null;
}

// ---- edits (each saved, then applied) ----

async function edit(task: () => Promise<unknown>): Promise<void> {
  await task();
  const day = localDayKey(Date.now());
  setState(await siteBlockingRepository.load(day));
}

export function addSite(list: SiteListName, site: string): Promise<void> {
  const current = list === 'blocked' ? state.blockedSites : state.focusSites;
  if (current.includes(site) || current.length >= (list === 'blocked' ? MAX_BLOCKED_SITES : MAX_FOCUS_SITES)) {
    return Promise.resolve();
  }
  return edit(() => siteBlockingRepository.addSite(list, site));
}

export function removeSite(list: SiteListName, site: string): Promise<void> {
  return edit(() => siteBlockingRepository.removeSite(list, site));
}

export function setTimeLimit(site: string, minutes: number): Promise<void> {
  if (!(site in state.timeLimits) && Object.keys(state.timeLimits).length >= MAX_TIME_LIMITS) return Promise.resolve();
  return edit(() => siteBlockingRepository.setTimeLimit(site, minutes));
}

export function removeTimeLimit(site: string): Promise<void> {
  return edit(() => siteBlockingRepository.removeTimeLimit(site));
}

export function startFocus(minutes: number): Promise<void> {
  return edit(() => siteBlockingRepository.startFocus(Date.now(), minutes));
}

export function endFocus(): Promise<void> {
  return edit(() => siteBlockingRepository.endFocus());
}

export function focusActive(now: number = Date.now()): boolean {
  return isFocusActive(state, now);
}

// ---- lifecycle ----

let stop: (() => void) | null = null;

/** Idempotent; the browser screen starts it. */
export function ensureSiteBlocking(): () => void {
  if (stop) return stop;
  void reload();
  const unsubscribeProfile = subscribeActiveProfile(() => {
    loaded = false;
    state = EMPTY_SITE_LIMITS;
    pendingSeconds.clear();
    lastSite = null;
    lastTick = null;
    emit();
    void reload();
  });
  let ticker: ReturnType<typeof setInterval> | null = setInterval(() => tick(), TICK_MS);
  const appState: NativeEventSubscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      // A new day or a focus timer that ended while away; then the clock starts again.
      if (loaded) setState({ ...state });
      tick();
      if (!ticker) ticker = setInterval(() => tick(), TICK_MS);
    } else {
      stopClock();
      if (ticker) clearInterval(ticker);
      ticker = null;
    }
  });
  // A tab switch or a new page starts or stops the clock at once.
  const unsubscribeTabs = useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.currentUrl !== previous.currentUrl || next.error !== previous.error) {
      tick();
    }
  });
  stop = () => {
    stopClock();
    unsubscribeProfile();
    unsubscribeTabs();
    appState.remove();
    if (ticker) clearInterval(ticker);
    if (changeTimer) clearTimeout(changeTimer);
    ticker = null;
    changeTimer = null;
    stop = null;
  };
  return stop;
}
