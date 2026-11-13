import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';
import { useBrowserStore } from '@/browser/stores';
import { useSettingsStore } from '@/store/settings';

import {
  INITIAL_AUTO_HIDE,
  onAutoHideHold,
  onAutoHideScroll,
  type AutoHideHold,
  type AutoHideState,
} from './auto-hide';

/**
 * B4 #29 — whether the address bar is hidden by Auto-hide right now. Fed by the active tab's page scroll reports
 * (`useBrowserChromeBridge`, ≤ 5/s) and by the holds that must show it (loading, editing, "Video available", the
 * setting off). The rules are pure (`auto-hide.ts`); this only keeps the state and tells the header.
 */

type Listener = () => void;

let state: AutoHideState = INITIAL_AUTO_HIDE;
let editing = false;
const listeners = new Set<Listener>();

/** A verified offer is on screen ("Video available"). */
function videoOfferShown(): boolean {
  try {
    const status = browserMediaActionService.getState().status;
    return status === 'verified' || status === 'preparing';
  } catch {
    return false;
  }
}

function currentHold(): AutoHideHold {
  return {
    enabled: useSettingsStore.getState().addressBarAutoHide === true,
    loading: useBrowserStore.getState().isLoading,
    editing,
    videoOffer: videoOfferShown(),
  };
}

function set(next: AutoHideState): void {
  const changed = next.hidden !== state.hidden;
  state = next;
  if (changed) {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }
}

function recheckHolds(): void {
  set(onAutoHideHold(state, currentHold()));
}

let wired = false;
function wireHolds(): void {
  if (wired) return;
  wired = true;
  // A new page, a load, the setting turned off, or an offer appearing shows the bar at once.
  useBrowserStore.subscribe((next, previous) => {
    if (next.activeTabId !== previous.activeTabId || next.currentUrl !== previous.currentUrl) {
      set(INITIAL_AUTO_HIDE);
    } else if (next.isLoading !== previous.isLoading) {
      recheckHolds();
    }
  });
  useSettingsStore.subscribe((next, previous) => {
    if (next.addressBarAutoHide !== previous.addressBarAutoHide) recheckHolds();
  });
  browserMediaActionService.subscribe(recheckHolds);
}

export const addressBarVisibility = {
  isHidden(): boolean {
    return state.hidden;
  },

  /** The active tab's page is at `scrollY`. */
  onPageScroll(scrollY: number): void {
    wireHolds();
    if (!currentHold().enabled && !state.hidden) return;
    set(onAutoHideScroll(state, scrollY, currentHold()));
  },

  /** The address bar is being edited (its overlay is open). */
  setEditing(value: boolean): void {
    editing = value;
    if (value) recheckHolds();
  },

  subscribe(listener: Listener): () => void {
    wireHolds();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
