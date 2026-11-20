/**
 * P8 #461 / #514: what the engine's probe said about a link, kept in memory for the Source check badge (the redirect
 * count) and the Malware Warning (a "video" whose bytes are a program). `observeEngine` wraps the one engine port so
 * every probe — browser detection, pasted links, batch add — is seen without touching each caller. Never persisted.
 * Pure (no native imports).
 */

import type { ProbeRequest, ProbeResult } from '@modules/vidorax-media/src/VidoraMedia.types';

export type ProbeObservation = { redirects: number; finalUrl: string | null };

const MAX_OBSERVATIONS = 200;
const observations = new Map<string, ProbeObservation>();
const disguisedListeners = new Set<(url: string, kind: string) => void>();

function remember(url: string, observation: ProbeObservation): void {
  observations.delete(url);
  observations.set(url, observation);
  while (observations.size > MAX_OBSERVATIONS) {
    observations.delete(observations.keys().next().value as string);
  }
}

/** Records one probe's answer under the asked URL and the final URL. */
export function recordProbe(url: string, result: ProbeResult | null | undefined): void {
  if (!result || typeof url !== 'string' || !url) {
    return;
  }
  if (result.ok) {
    const redirects = typeof result.redirects === 'number' && Number.isFinite(result.redirects) ? result.redirects : 0;
    const observation = { redirects, finalUrl: result.finalUrl ?? null };
    remember(url, observation);
    if (result.finalUrl && result.finalUrl !== url) {
      remember(result.finalUrl, observation);
    }
    return;
  }
  if (result.disguisedAs) {
    reportDisguised(url, result.disguisedAs);
  }
}

/** A "video" link whose bytes are a program or an archive (the probe's, or the browser verifier's own read). */
export function reportDisguised(url: string, kind: string): void {
  for (const listener of disguisedListeners) {
    try {
      listener(url, kind);
    } catch {
      // A listener failing must not fail the caller.
    }
  }
}

/** The redirect count a probe of one of these URLs reported (the largest), or null when none was probed. */
export function redirectsFor(urls: readonly (string | null | undefined)[]): number | null {
  let found: number | null = null;
  for (const url of urls) {
    const observation = url ? observations.get(url) : undefined;
    if (observation) {
      found = Math.max(found ?? 0, observation.redirects);
    }
  }
  return found;
}

/** Called for a probe that found a program or archive behind a "video" link. */
export function onDisguisedProbe(listener: (url: string, kind: string) => void): () => void {
  disguisedListeners.add(listener);
  return () => {
    disguisedListeners.delete(listener);
  };
}

type ProbingEngine = { probe(request: ProbeRequest): Promise<ProbeResult> };

const wrapped = new WeakMap<object, object>();

/**
 * The same engine, its `probe` recorded. Every other member is the engine's own (functions bound to it), so callers
 * cannot tell the difference.
 */
export function observeEngine<T extends ProbingEngine>(engine: T): T {
  const cached = wrapped.get(engine);
  if (cached) {
    return cached as T;
  }
  const probe = async (request: ProbeRequest): Promise<ProbeResult> => {
    const result = await engine.probe(request);
    recordProbe(request.url, result);
    return result;
  };
  const proxy = new Proxy(engine, {
    get(target, property) {
      if (property === 'probe') {
        return probe;
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  wrapped.set(engine, proxy);
  return proxy;
}

export function resetProbeObservationsForTests(): void {
  observations.clear();
  disguisedListeners.clear();
}
