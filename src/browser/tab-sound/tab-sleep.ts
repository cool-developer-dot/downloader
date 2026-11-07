/**
 * B3 #15 — tab sleeping. Pure.
 *
 * At most two tabs have a live page (the WebView pool); the others already hold no page and load their address when
 * opened. Sleeping frees the second live page early: a tab not used for the chosen time gives up its WebView and loads
 * its address again when it is opened. The tab in front and a tab playing sound never sleep.
 */

export type TabSleepAfter = 'off' | '15m' | '30m' | '1h' | '3h';

export const TAB_SLEEP_CHOICES: readonly TabSleepAfter[] = ['off', '15m', '30m', '1h', '3h'];

/** Default: off — today's behaviour (a sleeping tab reloads its page, losing what was typed in it). */
export const DEFAULT_TAB_SLEEP_AFTER: TabSleepAfter = 'off';

const MINUTE = 60_000;
const AFTER_MS: Record<Exclude<TabSleepAfter, 'off'>, number> = {
  '15m': 15 * MINUTE,
  '30m': 30 * MINUTE,
  '1h': 60 * MINUTE,
  '3h': 180 * MINUTE,
};

export function normalizeTabSleepAfter(value: unknown): TabSleepAfter {
  return TAB_SLEEP_CHOICES.includes(value as TabSleepAfter) ? (value as TabSleepAfter) : DEFAULT_TAB_SLEEP_AFTER;
}

export function tabSleepAfterMs(choice: TabSleepAfter): number | null {
  return choice === 'off' ? null : AFTER_MS[choice];
}

/**
 * The hook B18's battery saver uses to make tabs sleep sooner: given the user's time (null = off), return the time to
 * use. Unbound = the user's time.
 */
export type TabSleepShortener = (afterMs: number | null) => number | null;

export function tabsToSleep(input: {
  tabs: readonly { id: string; lastActiveAt: number }[];
  mountedTabIds: readonly string[];
  activeTabId: string;
  nowMs: number;
  afterMs: number | null;
  isPlaying: (tabId: string) => boolean;
}): string[] {
  if (input.afterMs == null || input.afterMs <= 0) return [];
  return input.mountedTabIds.filter((id) => {
    if (id === input.activeTabId || input.isPlaying(id)) return false;
    const tab = input.tabs.find((t) => t.id === id);
    return tab != null && input.nowMs - tab.lastActiveAt >= input.afterMs!;
  });
}

/** Awake = has a live page; asleep = every other tab. */
export function tabWakeCounts(tabCount: number, mountedTabIds: readonly string[], tabIds: readonly string[]) {
  const awake = mountedTabIds.filter((id) => tabIds.includes(id)).length;
  return { awake, asleep: Math.max(0, tabCount - awake) };
}
