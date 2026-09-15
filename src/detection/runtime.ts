/**
 * Connects the pure detection logic to the store and the native modules: WebView messages, network batches,
 * WebView downloads, tab lifecycle, the shared resolver and opening the sheet.
 */
import { getVidoraMedia, isVidoraMediaAvailable, type ProbeResult } from '@modules/vidorax-media';
import type { NetworkMediaBatchEvent, WebDownloadEvent } from '@modules/vidorax-web';

import { translate } from '@/localization';

import { parseDetectorMessage } from './messages';
import { forgetTab, noteTabActivity, routeObservations, tabForViewTag, webDownloadCandidate } from './network';
import { createResolver } from './resolve';
import * as store from './store';

const MEDIA_MODULE_MISSING: ProbeResult = { ok: false, reason: 'NETWORK', httpStatus: null, message: null };

export const resolver = createResolver({
  probe: (request) => (isVidoraMediaAvailable() ? getVidoraMedia().probe(request) : Promise.resolve(MEDIA_MODULE_MISSING)),
  getTab: store.getTab,
  setAvailability: store.setAvailability,
  labels: () => ({
    original: translate('detection.option.original'),
    noAudio: translate('detection.option.noAudio'),
    watermark: translate('detection.option.watermark'),
  }),
  now: () => new Date(),
});

/** Ingests a WebView `onMessage` string. False when it is not a detector message (route it elsewhere). */
export function handleDetectorMessage(tabId: string, raw: string): boolean {
  const message = parseDetectorMessage(raw);
  if (!message) {
    return false;
  }
  noteTabActivity(tabId, Date.now());
  store.ingestMessage(tabId, message);
  return true;
}

/** A top-level document started loading in the tab (navigation or reload): its items are cleared. */
export function onTabDocumentStart(tabId: string, url: string): void {
  noteTabActivity(tabId, Date.now());
  store.onDocumentStart(tabId, url);
}

/** The tab URL changed without a new document (SPA navigation): items are kept. */
export function onTabUrlChange(tabId: string, url: string): void {
  store.onUrlChange(tabId, url);
}

/** The tab was closed. */
export function clearTab(tabId: string): void {
  forgetTab(tabId);
  store.clearTabState(tabId);
}

export function openMediaSheet(tabId: string, itemKey?: string): void {
  store.openSheet(tabId, itemKey ?? null);
}

export function ingestNetworkBatch({ observations }: NetworkMediaBatchEvent): void {
  for (const [tabId, tabObservations] of routeObservations(observations, store.tabLocations())) {
    store.ingestNetwork(tabId, tabObservations);
  }
}

/** Adds a file the page asked to download to its tab; returns the item it became, or null when unattributable. */
export function ingestWebDownload(event: WebDownloadEvent): { tabId: string; key: string } | null {
  const tabId = tabForViewTag(event.viewTag);
  const tab = tabId === null ? undefined : store.getTab(tabId);
  const candidate = tab ? webDownloadCandidate(event, tab.currentUrl) : null;
  if (tabId === null || !tab || !candidate) {
    return null;
  }
  store.ingestCandidate(tabId, candidate, { frameUrl: tab.currentUrl, userAgent: event.userAgent });
  // The merged item (possibly an existing one that already owned this media) is always moved to the end.
  const key = store.getTab(tabId)?.order.at(-1);
  return key ? { tabId, key } : null;
}
