/**
 * Bounded early-network / late-identity candidate window.
 * Keyed by tab + navigation epoch + page/media generation + platform.
 * No timers. Count-bounded. Re-evaluated when identity becomes available.
 */

import type { DetectedMedia } from '../types';

export type CandidateWindowKey = {
  tabId: string;
  navigationEpoch: number;
  generation: number;
  platform: string;
};

export type WindowedCandidate = {
  media: DetectedMedia;
  observedAt: number;
};

const MAX_KEYS = 8;
const MAX_PER_KEY = 8;

const windows = new Map<string, WindowedCandidate[]>();

function serializeKey(key: CandidateWindowKey): string {
  return `${key.tabId}|${key.navigationEpoch}|${key.generation}|${key.platform}`;
}

function isBlobUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.toLowerCase().startsWith('blob:'));
}

function evictOldestKeyIfNeeded(): void {
  if (windows.size < MAX_KEYS) {
    return;
  }
  const first = windows.keys().next().value;
  if (typeof first === 'string') {
    windows.delete(first);
  }
}

export function observeCandidateInWindow(
  key: CandidateWindowKey,
  media: DetectedMedia,
): void {
  if (!key.tabId || isBlobUrl(media.url) || isBlobUrl(media.finalUrl)) {
    return;
  }
  const id = serializeKey(key);
  let list = windows.get(id);
  if (!list) {
    evictOldestKeyIfNeeded();
    list = [];
    windows.set(id, list);
  }
  const existing = list.findIndex(
    (entry) => entry.media.id === media.id || entry.media.url === media.url,
  );
  const next: WindowedCandidate = { media, observedAt: media.detectedAt || Date.now() };
  if (existing >= 0) {
    list[existing] = next;
    return;
  }
  list.unshift(next);
  if (list.length > MAX_PER_KEY) {
    list.length = MAX_PER_KEY;
  }
}

export function getWindowCandidates(key: CandidateWindowKey): DetectedMedia[] {
  const list = windows.get(serializeKey(key));
  if (!list || list.length === 0) {
    return [];
  }
  return list.map((entry) => entry.media);
}

/**
 * Merge windowed HTTP candidates that are not already in `existing`.
 */
export function mergeEligibleWindowCandidates(
  key: CandidateWindowKey,
  existing: DetectedMedia[],
): DetectedMedia[] {
  const seen = new Set(existing.map((item) => item.id));
  const urls = new Set(existing.map((item) => item.url));
  const merged = existing.slice();
  for (const media of getWindowCandidates(key)) {
    if (seen.has(media.id) || urls.has(media.url)) {
      continue;
    }
    if (isBlobUrl(media.url)) {
      continue;
    }
    seen.add(media.id);
    urls.add(media.url);
    merged.push(media);
  }
  return merged;
}

export function clearCandidateWindow(key: Partial<CandidateWindowKey> & { tabId: string }): void {
  if (key.navigationEpoch == null && key.generation == null && !key.platform) {
    for (const id of [...windows.keys()]) {
      if (id.startsWith(`${key.tabId}|`)) {
        windows.delete(id);
      }
    }
    return;
  }
  if (
    key.navigationEpoch != null &&
    key.generation != null &&
    key.platform
  ) {
    windows.delete(serializeKey(key as CandidateWindowKey));
  }
}

export function resetCandidateWindowsForTests(): void {
  windows.clear();
}

export function candidateWindowSizeForTests(): number {
  let n = 0;
  for (const list of windows.values()) {
    n += list.length;
  }
  return n;
}
