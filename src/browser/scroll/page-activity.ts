import { AppState } from 'react-native';

import { useBrowserStore } from '@/browser/stores';
import { useSettingsStore } from '@/store/settings';

import {
  AUTO_SCROLL_OFF,
  autoScrollPixelsPerSecond,
  autoScrollSpeedFactor,
  nextAutoScroll,
  type AutoScrollEvent,
  type AutoScrollState,
} from './auto-scroll';
import {
  fastScrollExpired,
  hideFastScroll,
  INITIAL_FAST_SCROLL,
  onFastScrollReport,
  SCROLL_JUMP_VISIBLE_MS,
  type FastScrollState,
  type ScrollJumpTarget,
} from './fast-scroll';
import { autoScrollScript } from './page-scroll-script';
import { runInActivePage } from './page-scroll.service';
import { normalizeScrollSpeed } from './scroll-speed';

/**
 * B6 — what the page in front is doing, for the browser's floating controls: the ↑ / ↓ jump button (#46 / #47), Auto
 * scroll (#54) and whether the page plays audible media (#240). Fed by the browser-chrome bridge (`scroll`,
 * `auto_scroll`, `media_state`); reset when the tab in front or its page changes, and Auto scroll stops when the app
 * goes to the background. The rules are the pure `fast-scroll.ts` and `auto-scroll.ts`.
 */

export type PageActivitySnapshot = {
  jumpTarget: ScrollJumpTarget | null;
  autoScroll: AutoScrollState;
};

type Listener = () => void;

let jump: FastScrollState = INITIAL_FAST_SCROLL;
let autoScroll: AutoScrollState = AUTO_SCROLL_OFF;
let snapshot: PageActivitySnapshot = { jumpTarget: null, autoScroll };
let jumpTimer: ReturnType<typeof setTimeout> | null = null;
const mediaPlaying = new Map<string, boolean>();
const listeners = new Set<Listener>();

function publish(): void {
  const next = { jumpTarget: autoScroll.status === 'off' ? jump.target : null, autoScroll };
  if (next.jumpTarget === snapshot.jumpTarget && next.autoScroll === snapshot.autoScroll) return;
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function scheduleJumpFade(): void {
  if (jumpTimer) clearTimeout(jumpTimer);
  jumpTimer = null;
  if (jump.target == null) return;
  jumpTimer = setTimeout(() => {
    jumpTimer = null;
    if (fastScrollExpired(jump, Date.now())) {
      jump = hideFastScroll(jump);
      publish();
    } else {
      scheduleJumpFade();
    }
  }, SCROLL_JUMP_VISIBLE_MS);
}

/** Applies an Auto scroll event and tells the page what changed. */
function dispatchAutoScroll(event: AutoScrollEvent): void {
  const previous = autoScroll;
  const next = nextAutoScroll(previous, event);
  if (next === previous) return;
  autoScroll = next;
  // B18 #191: Battery saver's share of the speed (1 when it is off).
  const pixelsPerSecond = Math.round(autoScrollPixelsPerSecond(next.level) * autoScrollSpeedFactor());
  if (next.status === 'running' && previous.status !== 'running') {
    runInActivePage(autoScrollScript({ type: 'start', pixelsPerSecond }));
  } else if (next.status === 'running' && next.level !== previous.level) {
    runInActivePage(autoScrollScript({ type: 'speed', pixelsPerSecond }));
  } else if (next.status !== 'running' && previous.status === 'running') {
    // The page already stopped itself for these two.
    if (event.type !== 'reachedBottom' && event.type !== 'touched') {
      runInActivePage(autoScrollScript({ type: 'stop' }));
    }
  }
  publish();
}

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.currentUrl !== previous.currentUrl) {
      jump = INITIAL_FAST_SCROLL;
      scheduleJumpFade();
      dispatchAutoScroll({ type: 'navigated' });
      publish();
    }
    // A tab's page changed: its media state is the old page's.
    for (const tab of next.tabs) {
      const before = previous.tabs.find((t) => t.id === tab.id);
      if (before && before.url !== tab.url) mediaPlaying.delete(tab.id);
    }
  });
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') dispatchAutoScroll({ type: 'background' });
  });
}

export const pageActivity = {
  getSnapshot(): PageActivitySnapshot {
    return snapshot;
  },

  subscribe(listener: Listener): () => void {
    wire();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** The page in front reported its scroll position (and heights). */
  onScroll(report: { y: number; height: number; viewHeight: number }): void {
    wire();
    if (report.height <= 0 || report.viewHeight <= 0) return;
    const before = jump.target;
    jump = onFastScrollReport(jump, { ...report, at: Date.now() });
    if (jump.target !== before || jump.target != null) scheduleJumpFade();
    publish();
  },

  hideJump(): void {
    jump = hideFastScroll(jump);
    scheduleJumpFade();
    publish();
  },

  startAutoScroll(): void {
    wire();
    dispatchAutoScroll({ type: 'start', speed: normalizeScrollSpeed(useSettingsStore.getState().scrollSpeed) });
  },

  autoScroll(event: Exclude<AutoScrollEvent, { type: 'start' }>): void {
    dispatchAutoScroll(event);
  },

  /** `auto_scroll` from the page in front. */
  onAutoScrollEvent(event: 'bottom' | 'touched'): void {
    dispatchAutoScroll({ type: event === 'bottom' ? 'reachedBottom' : 'touched' });
  },

  setMediaPlaying(tabId: string, playing: boolean): void {
    wire();
    mediaPlaying.set(tabId, playing);
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  },

  isMediaPlaying(tabId: string): boolean {
    return mediaPlaying.get(tabId) === true;
  },
};
