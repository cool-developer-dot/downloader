import { getVidoraMedia, isVidoraMediaAvailable } from '@modules/vidorax-media';

import type { LinkRules } from '@/downloads/bulk/link-rules';

import { normalizeWatchInterval, parseWatchAdd, parseWatchedLink, parseWatchedLinks, type WatchAddResult, type WatchedLink, type WatchKind } from './watch-core';

/**
 * The native watched links (modules/vidorax-media watch/Watches.kt): stored on the phone, checked by a JobScheduler
 * job about every hour (only the links that are due). Null on a build without them, and the feature stays hidden.
 */
export type WatchPort = {
  list(): Promise<WatchedLink[]>;
  add(url: string, options: { kind?: WatchKind; intervalHours: number; autoDownload: boolean }): Promise<WatchAddResult>;
  update(id: string, change: { intervalHours?: number; autoDownload?: boolean }): Promise<WatchedLink | null>;
  remove(id: string): Promise<boolean>;
  check(id: string): Promise<WatchedLink | null>;
};

let override: WatchPort | null | undefined;

export function setWatchPortForTests(port: WatchPort | null | undefined): void {
  override = port;
}

function parseOne(json: string | null | undefined): WatchedLink | null {
  if (!json) return null;
  try {
    return parseWatchedLink(JSON.parse(json));
  } catch {
    return null;
  }
}

let cached: WatchPort | null = null;

/** The same object on every call (screens use it in effect dependencies). */
export function getWatchPort(): WatchPort | null {
  if (override !== undefined) return override;
  if (cached) return cached;
  cached = createWatchPort();
  return cached;
}

function createWatchPort(): WatchPort | null {
  if (!isVidoraMediaAvailable()) return null;
  const media = getVidoraMedia();
  const { watchList, watchAdd, watchUpdate, watchRemove, watchCheck } = media;
  if (!watchList || !watchAdd || !watchUpdate || !watchRemove || !watchCheck) return null;
  return {
    list: async () => parseWatchedLinks(await watchList.call(media)),
    add: async (url, options) =>
      parseWatchAdd(await watchAdd.call(media, url, options.kind ?? null, normalizeWatchInterval(options.intervalHours), options.autoDownload)),
    update: async (id, change) =>
      parseOne(
        await watchUpdate.call(
          media,
          id,
          change.intervalHours === undefined ? null : normalizeWatchInterval(change.intervalHours),
          change.autoDownload ?? null,
        ),
      ),
    remove: (id) => watchRemove.call(media, id),
    check: async (id) => parseOne(await watchCheck.call(media, id)),
  };
}

let lastRulesJson: string | null = null;

/** #505: hands the download rules to native for background feed downloads, only when they changed. */
export function pushLinkRulesToNative(rules: LinkRules): void {
  const json = JSON.stringify(rules);
  if (json === lastRulesJson || !isVidoraMediaAvailable()) return;
  const media = getVidoraMedia();
  if (!media.setBulkRules) return;
  lastRulesJson = json;
  media.setBulkRules(json).catch(() => {
    lastRulesJson = null;
  });
}
