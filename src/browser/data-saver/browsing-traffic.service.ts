import { useSyncExternalStore } from 'react';
import { AppState, type NativeEventSubscription } from 'react-native';

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';
import { isBrowserRouteVisible, subscribeBrowserRouteVisible } from '@/browser/webview/webview-activity';
import { getDataUsageSummary } from '@/downloads/v2/data-usage-store';
import { getMmkvInstance } from '@/storage/mmkv';

import {
  addBrowsingBytes,
  EMPTY_BROWSING_TRAFFIC,
  intervalBrowsingBytes,
  parseBrowsingTraffic,
  summarizeBrowsing,
  type BrowsingTrafficState,
  type TrafficMark,
} from './browsing-traffic';

/**
 * B18 #185 — the Data usage screen's "Browsing" figures. An interval is open while the app is active and the Browser
 * route is shown; it is closed (and counted, see browsing-traffic.ts) when either stops. Download numbers are only
 * read (H6 `getDataUsageSummary`); nothing in the download code changes. Saved in MMKV under its own key.
 */

export const BROWSING_TRAFFIC_KEY = 'vidorax.browsingData.v1';

let state: BrowsingTrafficState | null = null;
let open: TrafficMark | null = null;
let version = 0;
const listeners = new Set<() => void>();
let started = false;

function load(): BrowsingTrafficState {
  if (!state) {
    let raw: string | undefined;
    try {
      raw = getMmkvInstance()?.getString(BROWSING_TRAFFIC_KEY);
    } catch {
      raw = undefined;
    }
    state = parseBrowsingTraffic(raw);
  }
  return state;
}

function save(): void {
  try {
    getMmkvInstance()?.set(BROWSING_TRAFFIC_KEY, JSON.stringify(load()));
  } catch {
    // Counting must never disturb browsing.
  }
}

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore
    }
  }
}

function mark(): TrafficMark | null {
  try {
    if (!isVidoraWebAvailable()) return null;
    const reading = getVidoraWeb().getAppTraffic?.();
    if (!reading) return null;
    return { ...reading, downloadedBytes: getDataUsageSummary().totalBytes };
  } catch {
    return null;
  }
}

function browsingNow(): boolean {
  return AppState.currentState === 'active' && isBrowserRouteVisible();
}

/** Closes the open interval (counting it) and opens a new one when the browser is still in front. */
function sample(): void {
  const end = mark();
  if (open && end) {
    const bytes = intervalBrowsingBytes(open, end);
    if (bytes != null && bytes > 0) {
      state = addBrowsingBytes(load(), bytes, Date.now());
      save();
      emit();
    }
  }
  open = browsingNow() ? end : null;
}

/** Idempotent; the browser screen starts it. */
export function ensureBrowsingTraffic(): () => void {
  if (started) return () => undefined;
  started = true;
  load();
  open = browsingNow() ? mark() : null;
  const appState: NativeEventSubscription = AppState.addEventListener('change', () => sample());
  const unsubscribeRoute = subscribeBrowserRouteVisible(() => sample());
  return () => {
    sample();
    open = null;
    appState.remove();
    unsubscribeRoute();
    started = false;
  };
}

export function browsingSummary(now: number = Date.now()): { todayBytes: number; monthBytes: number } {
  return summarizeBrowsing(load(), now);
}

/** Counts what is open so far (the Data usage screen calls it when it opens). */
export function refreshBrowsingTraffic(): void {
  if (open) sample();
  emit();
}

export function resetBrowsingTraffic(): void {
  state = EMPTY_BROWSING_TRAFFIC;
  // The open interval starts again from now, so nothing before the reset is counted.
  open = browsingNow() ? mark() : null;
  save();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = () => version;

export function useBrowsingSummary(): { todayBytes: number; monthBytes: number } {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return browsingSummary();
}

/** Whether this phone counts per-app traffic (else the screen says so). */
export function browsingTrafficSupported(): boolean {
  try {
    return isVidoraWebAvailable() && getVidoraWeb().getAppTraffic?.() != null;
  } catch {
    return false;
  }
}
