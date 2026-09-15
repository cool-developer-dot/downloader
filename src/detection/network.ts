/**
 * Native network observations and WebView downloads -> per-tab detection input.
 *
 * Holds the WebView view tag <-> tab registry. Manifests and progressive files become `url:` items with
 * provenance 'network' (Referer from the observation); segments and range requests only mark which item is
 * being played. Service-worker requests (view tag -1) go to the tab whose current origin matches the Referer.
 */
import type { NetworkMediaObservation, WebDownloadEvent } from '@modules/vidorax-web/src/VidoraWeb.types';

import { markActivity, upsertCandidate, type TabState } from './tab-state.ts';
import type { CandidateSource, PageCandidate } from './types.ts';
import {
  groupingKey,
  hasByteRangeParams,
  isHttpUrl,
  isPolicyBlockedUrl,
  originOf,
  parseHttpUrl,
  siteForUrl,
} from './url.ts';

const SERVICE_WORKER_VIEW_TAG = -1;
const MAX_TITLE_LENGTH = 300;
const HLS_MIME_TYPES = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl']);
const DASH_MIME_TYPE = 'application/dash+xml';

const tabByViewTag = new Map<number, string>();
const viewTagByTab = new Map<string, number>();
const lastActivityByTab = new Map<string, number>();

export function registerWebViewTag(tabId: string, viewTag: number): void {
  const previous = viewTagByTab.get(tabId);
  if (previous !== undefined) {
    tabByViewTag.delete(previous);
  }
  tabByViewTag.set(viewTag, tabId);
  viewTagByTab.set(tabId, viewTag);
}

export function unregisterWebViewTag(tabId: string): void {
  const viewTag = viewTagByTab.get(tabId);
  if (viewTag !== undefined && tabByViewTag.get(viewTag) === tabId) {
    tabByViewTag.delete(viewTag);
  }
  viewTagByTab.delete(tabId);
}

export function tabForViewTag(viewTag: number): string | null {
  return tabByViewTag.get(viewTag) ?? null;
}

/** Recency used to pick a tab for service-worker requests when several tabs share an origin. */
export function noteTabActivity(tabId: string, at: number): void {
  lastActivityByTab.set(tabId, at);
}

export function forgetTab(tabId: string): void {
  unregisterWebViewTag(tabId);
  lastActivityByTab.delete(tabId);
}

export interface TabLocation {
  tabId: string;
  currentUrl: string;
}

export function routeObservations(
  observations: readonly NetworkMediaObservation[],
  tabs: readonly TabLocation[],
): Map<string, NetworkMediaObservation[]> {
  const routed = new Map<string, NetworkMediaObservation[]>();
  for (const observation of observations) {
    const tabId =
      observation.viewTag === SERVICE_WORKER_VIEW_TAG
        ? tabForServiceWorker(observation.referer, tabs)
        : tabForViewTag(observation.viewTag);
    if (tabId === null) {
      continue;
    }
    const list = routed.get(tabId);
    if (list) {
      list.push(observation);
    } else {
      routed.set(tabId, [observation]);
    }
  }
  return routed;
}

export type NetworkSignal =
  | { type: 'media'; source: CandidateSource; referer: string | null }
  | { type: 'activity'; url: string; at: number };

export function classifyObservation(observation: NetworkMediaObservation): NetworkSignal | null {
  const { url, hint } = observation;
  if (observation.method.toUpperCase() !== 'GET' || !isHttpUrl(url) || isPolicyBlockedUrl(url)) {
    return null;
  }
  if (hint === 'segment' || hint === 'range-media' || hasByteRangeParams(url)) {
    return { type: 'activity', url, at: observation.observedAt };
  }
  const kind =
    hint === 'manifest-hls'
      ? 'hls'
      : hint === 'manifest-dash'
        ? 'dash'
        : hint === 'progressive'
          ? 'progressive'
          : manifestKindFromPath(url);
  if (!kind) {
    return null;
  }
  return { type: 'media', source: { kind, url }, referer: isHttpUrl(observation.referer) ? observation.referer : null };
}

export function applyObservations(
  tab: TabState,
  observations: readonly NetworkMediaObservation[],
  now: number,
): TabState {
  return observations.reduce((next, observation) => {
    const signal = classifyObservation(observation);
    if (!signal) {
      return next;
    }
    if (signal.type === 'activity') {
      return markActivity(next, signal.url, signal.at);
    }
    const candidate = urlCandidate(signal.source, next.currentUrl, 'network');
    return candidate
      ? upsertCandidate(
          next,
          candidate,
          { frameUrl: signal.referer ?? next.currentUrl, userAgent: next.userAgent ?? '' },
          now,
        )
      : next;
  }, tab);
}

/** A file the page asked the WebView to download, offered in the sheet instead of Android's DownloadManager. */
export function webDownloadCandidate(event: WebDownloadEvent, pageUrl: string): PageCandidate | null {
  if (!isHttpUrl(event.url) || isPolicyBlockedUrl(event.url)) {
    return null;
  }
  const mimeType = event.mimeType?.split(';')[0].trim().toLowerCase() || undefined;
  let source: CandidateSource;
  if (mimeType && HLS_MIME_TYPES.has(mimeType)) {
    source = { kind: 'hls', url: event.url };
  } else if (mimeType === DASH_MIME_TYPE) {
    source = { kind: 'dash', url: event.url };
  } else {
    source = { kind: 'progressive', url: event.url };
    if (mimeType) source.mimeType = mimeType;
    if (event.contentLength !== null && event.contentLength > 0) source.sizeBytes = event.contentLength;
  }
  const candidate = urlCandidate(source, pageUrl, 'web-download');
  const title = titleFromFileName(fileNameFromContentDisposition(event.contentDisposition) ?? fileNameFromUrl(event.url));
  return candidate && title ? { ...candidate, title } : candidate;
}

export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const extended = /filename\*\s*=\s*[\w-]+'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, '')) || null;
    } catch {
      // Malformed percent-encoding: fall back to the plain filename parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  return plain ? (plain[1] ?? plain[2]).trim() || null : null;
}

function fileNameFromUrl(url: string): string | null {
  const segment = parseHttpUrl(url)?.path.split('/').pop() ?? '';
  if (!/\.[a-z0-9]{2,5}$/i.test(segment)) {
    return null;
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function titleFromFileName(name: string | null): string | null {
  const title = name
    ?.replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_\s]+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return title || null;
}

function urlCandidate(
  source: CandidateSource,
  pageUrl: string,
  provenance: PageCandidate['provenance'],
): PageCandidate | null {
  const key = groupingKey(source.url);
  return key ? { key: `url:${key}`, site: siteForUrl(pageUrl || source.url), sources: [source], provenance } : null;
}

function manifestKindFromPath(url: string): 'hls' | 'dash' | null {
  const path = parseHttpUrl(url)?.path.toLowerCase() ?? '';
  return path.endsWith('.m3u8') ? 'hls' : path.endsWith('.mpd') ? 'dash' : null;
}

function tabForServiceWorker(referer: string | null, tabs: readonly TabLocation[]): string | null {
  const refererOrigin = referer ? originOf(referer) : null;
  if (!refererOrigin) {
    return null;
  }
  let match: string | null = null;
  let matchActivity = -1;
  for (const tab of tabs) {
    const activity = lastActivityByTab.get(tab.tabId) ?? 0;
    if (activity > matchActivity && originOf(tab.currentUrl) === refererOrigin) {
      match = tab.tabId;
      matchActivity = activity;
    }
  }
  return match;
}
