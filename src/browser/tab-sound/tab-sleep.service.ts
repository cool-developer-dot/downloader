import { AppState, type NativeEventSubscription } from 'react-native';

import { pageActivity } from '@/browser/scroll/page-activity';
import { useBrowserStore } from '@/browser/stores';
import { useSettingsStore } from '@/store/settings';

import { normalizeTabSleepAfter, tabSleepAfterMs, tabsToSleep, type TabSleepShortener } from './tab-sleep';

/**
 * B3 #15 — checks once a minute (while the app is in the foreground and the setting is on) which tabs have not been
 * used for the chosen time and puts them to sleep (`browserStore.sleepTabs`).
 */

const CHECK_EVERY_MS = 60_000;

let shortener: TabSleepShortener | null = null;

/**
 * The named hook for B18's battery saver: it binds a function that shortens the time (e.g. to 5 minutes while saving).
 * Pass null to unbind.
 */
export function bindTabSleepShortener(next: TabSleepShortener | null): void {
  shortener = next;
}

/** The time after which an unused tab sleeps now (null = never). */
export function currentTabSleepAfterMs(): number | null {
  const base = tabSleepAfterMs(normalizeTabSleepAfter(useSettingsStore.getState().tabSleepAfter));
  if (!shortener) return base;
  try {
    return shortener(base);
  } catch {
    return base;
  }
}

/** Puts every tab that is due to sleep; returns how many. */
export function runTabSleepCheck(nowMs: number = Date.now()): number {
  const state = useBrowserStore.getState();
  const due = tabsToSleep({
    tabs: state.tabs,
    mountedTabIds: state.mountedTabIds,
    activeTabId: state.activeTabId,
    nowMs,
    afterMs: currentTabSleepAfterMs(),
    isPlaying: (tabId) => pageActivity.isMediaPlaying(tabId),
  });
  return due.length > 0 ? state.sleepTabs(due).length : 0;
}

let timer: ReturnType<typeof setInterval> | null = null;
let appState: NativeEventSubscription | null = null;

function startTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    runTabSleepCheck();
  }, CHECK_EVERY_MS);
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Idempotent; the browser screen starts it. */
export function ensureTabSleep(): () => void {
  if (AppState.currentState === 'active') startTimer();
  appState?.remove();
  appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') {
      runTabSleepCheck();
      startTimer();
    } else {
      stopTimer();
    }
  });
  return () => {
    stopTimer();
    appState?.remove();
    appState = null;
  };
}
