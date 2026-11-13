/**
 * Website video fullscreen state: which tab's page is fullscreen and which way the phone is held for it.
 * Pure — the orientation lock, the page exit and logging are injected (web-fullscreen.runtime.ts binds the real ones),
 * so Node tests drive it directly.
 */

import {
  normalizeWebVideoSize,
  webFullscreenOrientation,
  type WebFullscreenOrientation,
  type WebVideoSize,
} from './web-fullscreen-orientation';

export type WebFullscreenState = {
  /** Tab whose page is fullscreen, or null. */
  tabId: string | null;
  orientation: WebFullscreenOrientation | null;
};

/** What the page reported (browser-chrome `fullscreen` message). */
export type WebFullscreenReport = {
  active: boolean;
  size: Partial<WebVideoSize> | null;
};

/** Why the app takes the page out of fullscreen. */
export type WebFullscreenLeaveReason = 'back' | 'tab_switch' | 'tab_switcher' | 'background' | 'route';

/** Why a fullscreen page is gone without telling us (no `fullscreenchange` will come). */
export type WebFullscreenGoneReason = 'navigation' | 'render_process_gone' | 'unmount';

export type WebFullscreenDeps = {
  lockOrientation: (orientation: WebFullscreenOrientation) => Promise<void> | void;
  restoreOrientation: () => Promise<void> | void;
  /** Ask the tab's page to leave fullscreen (react-native-webview then removes the video view). */
  requestPageExit: (tabId: string) => void;
  log?: (fields: Record<string, string | number | boolean | null>) => void;
};

export type WebFullscreenController = {
  getState: () => WebFullscreenState;
  isFullscreen: () => boolean;
  subscribe: (listener: () => void) => () => void;
  /** A `fullscreen` report from a tab's page. Only the active tab may be fullscreen. */
  onPageReport: (tabId: string, isActiveTab: boolean, report: WebFullscreenReport) => void;
  /**
   * Takes the page out of fullscreen and restores portrait at once — not waiting for the page, so one that never
   * answers cannot trap Back or keep the app sideways. False when nothing was fullscreen.
   */
  leave: (reason: WebFullscreenLeaveReason) => boolean;
  /** Leaves when the fullscreen tab is no longer the active one. */
  leaveUnlessActiveTab: (activeTabId: string | null) => boolean;
  /** The tab's document went away (navigation, renderer gone, unmount): forget it and restore portrait. */
  onPageGone: (tabId: string, reason: WebFullscreenGoneReason) => void;
};

const IDLE: WebFullscreenState = { tabId: null, orientation: null };

function swallow(result: Promise<void> | void): void {
  if (result && typeof (result as Promise<void>).catch === 'function') {
    (result as Promise<void>).catch(() => undefined);
  }
}

export function createWebFullscreenController(deps: WebFullscreenDeps): WebFullscreenController {
  let state: WebFullscreenState = IDLE;
  const listeners = new Set<() => void>();

  const setState = (next: WebFullscreenState) => {
    if (next.tabId === state.tabId && next.orientation === state.orientation) {
      return;
    }
    state = next;
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A view listener must never break fullscreen handling.
      }
    });
  };

  const backToIdle = () => {
    setState(IDLE);
    swallow(deps.restoreOrientation());
  };

  const leave = (reason: WebFullscreenLeaveReason): boolean => {
    const tabId = state.tabId;
    if (tabId == null) {
      return false;
    }
    deps.log?.({ event: 'leave', reason, tabId });
    backToIdle();
    deps.requestPageExit(tabId);
    return true;
  };

  return {
    getState: () => state,
    isFullscreen: () => state.tabId != null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onPageReport(tabId, isActiveTab, report) {
      if (!report.active) {
        if (state.tabId === tabId) {
          deps.log?.({ event: 'exit', tabId });
          backToIdle();
        }
        return;
      }
      if (!isActiveTab) {
        deps.log?.({ event: 'refused_parked', tabId });
        deps.requestPageExit(tabId);
        return;
      }
      if (state.tabId != null && state.tabId !== tabId) {
        deps.requestPageExit(state.tabId);
      }
      const size = normalizeWebVideoSize(report.size);
      const orientation = webFullscreenOrientation(size);
      if (state.tabId === tabId && state.orientation === orientation) {
        return;
      }
      deps.log?.({
        event: state.tabId === tabId ? 'reorient' : 'enter',
        tabId,
        orientation,
        width: size?.width ?? null,
        height: size?.height ?? null,
      });
      setState({ tabId, orientation });
      swallow(deps.lockOrientation(orientation));
    },
    leave,
    leaveUnlessActiveTab(activeTabId) {
      if (state.tabId == null || state.tabId === activeTabId) {
        return false;
      }
      return leave('tab_switch');
    },
    onPageGone(tabId, reason) {
      if (state.tabId !== tabId) {
        return;
      }
      deps.log?.({ event: 'gone', reason, tabId });
      backToIdle();
    },
  };
}
