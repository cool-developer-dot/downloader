/**
 * Data usage (H6) at runtime: a second listener on the v2 engine's progress and state events (the download bridge
 * is untouched) feeding the pure counters in `data-usage.ts`, saved in MMKV under its own key. The screen reads a
 * small zustand store that is refreshed at most once a second. Limit alerts are in-app only and never pause or
 * block a download.
 */

// A namespace import: Alert and AppState are read only at runtime.
import * as ReactNative from 'react-native';

import { getMmkvInstance } from '@/storage/mmkv';
import { createStore } from '@/store/shared/create-store';
import { translate } from '@/localization/translate';
import { formatDownloadFileSize } from '@/screens/downloads/utils/download-format';

import {
  applyProgressEvent,
  applyStateEvent,
  checkDataLimits,
  parseDataUsage,
  resetCounters,
  summarizeDataUsage,
  type DataLimitAlert,
  type DataUsageState,
  type DataUsageSummary,
} from './data-usage';
import { getV2Engine } from './engine-port';

export const DATA_USAGE_STORAGE_KEY = 'vidorax.dataUsage.v1';
const SAVE_INTERVAL_MS = 2_000;
const PUBLISH_INTERVAL_MS = 1_000;

type LimitSource = () => { dailyMb: number; monthlyMb: number };

let state: DataUsageState | null = null;
let attached = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let limitSource: LimitSource = () => ({ dailyMb: 0, monthlyMb: 0 });
let pendingAlerts: DataLimitAlert[] = [];

export const useDataUsageStore = createStore<{ summary: DataUsageSummary }>(() => ({
  summary: { todayBytes: 0, monthBytes: 0, last30DaysBytes: 0, totalBytes: 0, completedCount: 0 },
}));

function load(): DataUsageState {
  if (!state) {
    let raw: string | undefined;
    try {
      raw = getMmkvInstance()?.getString(DATA_USAGE_STORAGE_KEY);
    } catch {
      raw = undefined;
    }
    state = parseDataUsage(raw);
  }
  return state;
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    getMmkvInstance()?.set(DATA_USAGE_STORAGE_KEY, JSON.stringify(load()));
  } catch {
    // Counting must never disturb downloads.
  }
}

function saveSoon(): void {
  if (!saveTimer) {
    saveTimer = setTimeout(saveNow, SAVE_INTERVAL_MS);
  }
}

function publish(): void {
  publishTimer = null;
  useDataUsageStore.setState({ summary: summarizeDataUsage(load(), Date.now()) });
}

function publishSoon(): void {
  if (!publishTimer) {
    publishTimer = setTimeout(publish, PUBLISH_INTERVAL_MS);
  }
}

function formatMb(bytes: number): string {
  return formatDownloadFileSize(String(Math.max(0, Math.round(bytes)))) ?? '0 B';
}

function showAlerts(alerts: DataLimitAlert[]): void {
  for (const alert of alerts) {
    try {
      ReactNative.Alert.alert(
        translate(alert.period === 'day' ? 'dataUsage.alertDayTitle' : 'dataUsage.alertMonthTitle'),
        translate('dataUsage.alertMessage', { used: formatMb(alert.usedBytes), limit: formatMb(alert.limitBytes) }),
        [{ text: translate('common.ok') }],
      );
    } catch {
      // No alert UI right now: nothing else to do; downloads continue regardless.
    }
  }
}

function checkLimits(): void {
  let limits = { dailyMb: 0, monthlyMb: 0 };
  try {
    limits = limitSource();
  } catch {
    return;
  }
  const result = checkDataLimits(load(), limits, Date.now());
  if (result.alerts.length === 0) {
    return;
  }
  state = result.state;
  saveNow();
  // In-app only: shown now when VidoraX is in front, otherwise the next time it is.
  if (ReactNative.AppState.currentState === 'active') {
    showAlerts(result.alerts);
  } else {
    pendingAlerts = [...pendingAlerts, ...result.alerts];
  }
}

export function setDataLimitSource(source: LimitSource): void {
  limitSource = source;
}

export function getDataUsageSummary(): DataUsageSummary {
  return summarizeDataUsage(load(), Date.now());
}

/** Re-reads the figures now (the screen calls it when it opens, so "today" is right after midnight). */
export function refreshDataUsageSummary(): void {
  publish();
}

export function resetDataUsageCounters(): void {
  state = resetCounters(load());
  saveNow();
  publish();
}

/** Subscribes once to the engine's events. A build without the native module counts nothing. */
export function ensureDataUsage(): void {
  if (attached) {
    return;
  }
  const engine = getV2Engine();
  if (!engine) {
    return;
  }
  attached = true;
  load();
  publish();
  const progress = engine.addListener('onDownloadProgress', (event) => {
    try {
      const next = applyProgressEvent(load(), event, Date.now());
      if (next !== state) {
        state = next;
        saveSoon();
        publishSoon();
        checkLimits();
      }
    } catch {
      // Counting must never disturb downloads.
    }
  });
  const states = engine.addListener('onDownloadStateChange', ({ record }) => {
    try {
      const next = applyStateEvent(load(), record);
      if (next !== state) {
        state = next;
        saveNow();
        publishSoon();
      }
    } catch {
      // Counting must never disturb downloads.
    }
  });
  const appState = ReactNative.AppState.addEventListener('change', (nextAppState) => {
    if (nextAppState === 'active') {
      publish();
      if (pendingAlerts.length > 0) {
        const alerts = pendingAlerts;
        pendingAlerts = [];
        showAlerts(alerts);
      }
    } else {
      saveNow();
    }
  });
  replaceListeners([progress, states, appState]);
}

const LISTENERS_KEY = '__vidoraxDataUsageListeners';
type Subscription = { remove(): void };

/**
 * Keeps the listeners on `globalThis`: a Fast Refresh re-runs this module (and its `attached` flag), so an earlier
 * copy's listeners are removed before new ones are added — bytes are never counted twice.
 */
function replaceListeners(next: Subscription[]): void {
  const store = globalThis as unknown as Record<string, Subscription[] | undefined>;
  for (const subscription of store[LISTENERS_KEY] ?? []) {
    try {
      subscription.remove();
    } catch {
      // already gone
    }
  }
  store[LISTENERS_KEY] = next;
}
