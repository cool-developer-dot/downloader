import { useSyncExternalStore } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Crypto from 'expo-crypto';
import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import { isIncognitoTabId } from '@/browser/incognito/incognito-state';
import { isValidBrowserPageUrl } from '@/browser/utils';
import { annotateRepository, type PageWatch } from '@/storage/repositories/annotate.repository';
import { useSettingsStore } from '@/store/settings';

import {
  checkFetchedPage,
  clampAlertHours,
  connectionAllows,
  MAX_WATCHES,
  PAGE_ALERT_TASK,
  type WatchCheck,
} from './page-alerts-core';

/**
 * B23 #289 — page change alerts. A watched page is fetched natively (vidorax-media `fetchPage`: public hosts only,
 * bounded) **without cookies** (none sent, none stored), its text hashed and compared. Checks run in
 * expo-background-task's single WorkManager worker every `pageAlertHours` (default 6, at least 1) — the phone decides
 * the exact time — on Wi-Fi only by default. The watches are those of the browser profile in use when the check runs
 * (the last one used). At most 20; never from an incognito tab.
 */

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 2_000_000;

let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function usePageAlertsVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version,
  );
}

/** Fetches a page without cookies and checks it against `lastHash`. */
export async function fetchAndCheck(url: string, lastHash: string): Promise<WatchCheck> {
  if (!isVidoraMediaAvailable()) return { status: 'failed' };
  const result = await getVidoraMedia()
    .fetchPage({ url, useSessionCookies: false, commitCookies: false, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES })
    .catch(() => null);
  if (!result) return { status: 'failed' };
  if (result.kind === 'media') return { status: 'cannotWatch' };
  if (result.kind === 'failure') return result.code === 'UNSUPPORTED_CONTENT' ? { status: 'cannotWatch' } : { status: 'failed' };
  return checkFetchedPage({ ok: true, status: result.status, text: result.body, contentType: result.contentType ?? '' }, lastHash);
}

export type WatchOutcome = 'watching' | 'already' | 'cannotWatch' | 'failed' | 'limit' | 'incognito';

/** Menu → Watch for changes, for the page of `tabId`. */
export async function watchPage(tabId: string, url: string, title: string): Promise<WatchOutcome> {
  if (isIncognitoTabId(tabId)) return 'incognito';
  if (!isValidBrowserPageUrl(url)) return 'failed';
  const existing = await annotateRepository.listWatches().catch(() => [] as PageWatch[]);
  if (existing.some((w) => w.url === url)) return 'already';
  if (existing.length >= MAX_WATCHES) return 'limit';
  const check = await fetchAndCheck(url, '');
  if (check.status === 'cannotWatch') return 'cannotWatch';
  if (check.status !== 'changed') return 'failed';
  const added = await annotateRepository
    .addWatch({ id: Crypto.randomUUID(), url, title: check.title || title, hash: check.hash })
    .catch(() => false);
  if (!added) return 'already';
  emit();
  await syncPageAlertTask();
  return 'watching';
}

export async function listWatchedPages(): Promise<PageWatch[]> {
  return annotateRepository.listWatches().catch(() => [] as PageWatch[]);
}

export async function unwatchPage(id: string): Promise<void> {
  await annotateRepository.deleteWatch(id).catch(() => false);
  emit();
  await syncPageAlertTask();
}

/** Registers the worker while there is something to watch (again when the interval changes); unregisters otherwise. */
export async function syncPageAlertTask(): Promise<void> {
  try {
    if (!TaskManager.isTaskDefined(PAGE_ALERT_TASK)) return;
    const count = await annotateRepository.countWatches().catch(() => 0);
    const registered = await TaskManager.isTaskRegisteredAsync(PAGE_ALERT_TASK);
    if (count === 0) {
      if (registered) await BackgroundTask.unregisterTaskAsync(PAGE_ALERT_TASK);
      return;
    }
    const minutes = clampAlertHours(useSettingsStore.getState().pageAlertHours) * 60;
    // Registering again replaces the interval (the last registration sets it).
    await BackgroundTask.registerTaskAsync(PAGE_ALERT_TASK, { minimumInterval: minutes });
  } catch {
    // Background work unavailable: watches stay, nothing is checked.
  }
}

export type CheckRun = { checked: number; changed: { url: string; title: string }[] };

/** One background run: every watch, sequentially; the changes come back for the notification. */
export async function runPageChecks(): Promise<CheckRun> {
  const run: CheckRun = { checked: 0, changed: [] };
  const settings = useSettingsStore.getState();
  const net = await NetInfo.fetch().catch(() => null);
  if (!net || !connectionAllows(net.type, net.isConnected === true, settings.pageAlertWifiOnly !== false)) return run;
  const watches = await annotateRepository.listWatches().catch(() => [] as PageWatch[]);
  for (const watch of watches) {
    const check = await fetchAndCheck(watch.url, watch.hash);
    run.checked += 1;
    if (check.status === 'changed') {
      // The first hash comes from the page as it was when watched; a change is any later difference.
      await annotateRepository.recordCheck(watch.id, { status: 'ok', hash: check.hash, title: check.title, changed: true }).catch(() => undefined);
      run.changed.push({ url: watch.url, title: check.title || watch.title || watch.url });
    } else if (check.status === 'same') {
      await annotateRepository.recordCheck(watch.id, { status: 'ok', changed: false }).catch(() => undefined);
    } else {
      await annotateRepository.recordCheck(watch.id, { status: check.status, changed: false }).catch(() => undefined);
    }
  }
  return run;
}
