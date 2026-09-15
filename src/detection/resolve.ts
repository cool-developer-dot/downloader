/**
 * Lazily turns a MediaItem into DownloadOptions by probing its sources through native.
 *
 * The result is cached as the item's availability in the store. A new document or changed sources make an
 * in-flight result stale; it is then dropped (the store ignores it) and the caller gets null.
 */
import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import {
  finalizeOptions,
  mostSpecificReason,
  optionsFromProbe,
  probeRequestFor,
  unsupportedReason,
  type OptionLabels,
  type PageContext,
} from './options.ts';
import type { TabState, TrackedItem } from './tab-state.ts';
import type { ItemAvailability, UnsupportedReason } from './types.ts';

const MAX_PROBES_PER_ITEM = 8;
const PROBE_CONCURRENCY = 3;

export type ProbeFn = (request: ProbeRequest) => Promise<ProbeResult>;

export async function resolveItem(
  item: TrackedItem,
  page: PageContext,
  probe: ProbeFn,
  labels: OptionLabels,
): Promise<ItemAvailability> {
  const sources = item.sources.slice(0, MAX_PROBES_PER_ITEM);
  const results = await mapLimited(sources, PROBE_CONCURRENCY, (source) =>
    probeSafely(probe, probeRequestFor(item, source, page)),
  );

  const ranked = [];
  const reasons: UnsupportedReason[] = [];
  for (const [index, result] of results.entries()) {
    if (!result.ok) {
      reasons.push(unsupportedReason(result.reason));
      continue;
    }
    const built = optionsFromProbe(item, sources[index], result, page, labels);
    if ('reason' in built) {
      reasons.push(built.reason);
    } else {
      ranked.push(...built.ranked);
    }
  }
  const options = finalizeOptions(ranked);
  return options.length > 0
    ? { status: 'ready', options }
    : { status: 'unsupported', reason: mostSpecificReason(reasons) };
}

export interface ResolverDeps {
  probe: ProbeFn;
  getTab(tabId: string): TabState | undefined;
  /** Must ignore writes for another document or item revision (see tab-state setItemAvailability). */
  setAvailability(
    tabId: string,
    documentId: number,
    key: string,
    revision: number,
    availability: ItemAvailability,
  ): void;
  labels(): OptionLabels;
  now(): Date;
}

export interface Resolver {
  /** Resolves the item unless a result exists. Null when the item is gone or changed meanwhile. */
  ensureResolved(tabId: string, key: string): Promise<ItemAvailability | null>;
  /** Resolves again even when a result exists, e.g. to retry a source that could not be reached. */
  refresh(tabId: string, key: string): Promise<ItemAvailability | null>;
}

export function createResolver(deps: ResolverDeps): Resolver {
  const inFlight = new Map<string, Promise<ItemAvailability | null>>();

  function run(tabId: string, key: string, force: boolean): Promise<ItemAvailability | null> {
    const tab = deps.getTab(tabId);
    const item = tab?.items[key];
    if (!tab || !item) {
      return Promise.resolve(null);
    }
    const { availability } = item;
    if (!force && (availability.status === 'ready' || availability.status === 'unsupported')) {
      return Promise.resolve(availability);
    }
    const { documentId } = tab;
    const { revision } = item;
    const flightKey = `${tabId}\n${documentId}\n${key}\n${revision}`;
    const pending = inFlight.get(flightKey);
    if (pending) {
      return pending;
    }

    deps.setAvailability(tabId, documentId, key, revision, { status: 'resolving' });
    const page: PageContext = {
      currentUrl: tab.currentUrl,
      pageTitle: tab.pageTitle,
      userAgent: tab.userAgent,
      date: deps.now(),
    };
    const flight = resolveItem(item, page, deps.probe, deps.labels())
      // Option building is pure; never leave the item spinning if it throws.
      .catch((): ItemAvailability => ({ status: 'unsupported', reason: 'SOURCE_UNAVAILABLE' }))
      .then((result) => {
        inFlight.delete(flightKey);
        deps.setAvailability(tabId, documentId, key, revision, result);
        const current = deps.getTab(tabId);
        return current?.documentId === documentId && current.items[key]?.revision === revision ? result : null;
      });
    inFlight.set(flightKey, flight);
    return flight;
  }

  return {
    ensureResolved: (tabId, key) => run(tabId, key, false),
    refresh: (tabId, key) => run(tabId, key, true),
  };
}

async function probeSafely(probe: ProbeFn, request: ProbeRequest): Promise<ProbeResult> {
  try {
    return await probe(request);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const reason =
      code === 'ERR_POLICY_BLOCKED' ? 'POLICY_BLOCKED' : code === 'ERR_INVALID_REQUEST' ? 'UNSUPPORTED_FORMAT' : 'NETWORK';
    return { ok: false, reason, httpStatus: null, message: null };
  }
}

async function mapLimited<T, R>(values: readonly T[], limit: number, map: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await map(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}
