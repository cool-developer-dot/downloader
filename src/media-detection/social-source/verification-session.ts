/**
 * Bounded ephemeral verification cache + in-flight dedupe.
 * Scoped by tab + navigation + social context + content + resource identity.
 *
 * Phase 6B: cached variants never retain Cookie/Authorization header values.
 */

import type { VerifiedSocialMediaVariant } from './types';
import { stripRequestContextSecrets } from '../session-media/strip-secrets';

type CacheKey = string;

/**
 * One verification shared by every caller asking for the same key. Its own abort signal fires only when every
 * caller waiting for it has given up: one caller cancelling (a newer verification, a navigation) must not cancel the
 * work another caller is still waiting for — that left the joined callers with nothing and no offer at all.
 */
type InFlightEntry = {
  promise: Promise<VerifiedSocialMediaVariant | null>;
  controller: AbortController;
  /** Callers still waiting (their own signal not aborted). */
  waiting: number;
  /** A caller without a signal can never give up, so the job is never cancelled. */
  pinned: boolean;
  startedAt: number;
};

type CacheEntry = {
  variant: VerifiedSocialMediaVariant;
  expiresAt: number;
};

const VERIFICATION_TTL_MS = 45_000;
const MAX_ENTRIES = 48;
/** A shared verification older than this is presumed stuck and is never joined again. */
const IN_FLIGHT_STALE_MS = 60_000;

const inFlight = new Map<CacheKey, InFlightEntry>();
const verifiedCache = new Map<CacheKey, CacheEntry>();

export function buildVerificationCacheKey(input: {
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
  contentIdentity: string;
  executableUrl: string;
}): CacheKey {
  // Verification is for this executable URL, including its current credential.
  const path = input.executableUrl;
  return [
    input.tabId,
    String(input.navigationEpoch),
    String(input.socialContextGeneration),
    input.contentIdentity,
    path,
  ].join('::');
}

export function getCachedVerifiedVariant(
  key: CacheKey,
): VerifiedSocialMediaVariant | null {
  const entry = verifiedCache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    verifiedCache.delete(key);
    return null;
  }
  return entry.variant;
}

export function setCachedVerifiedVariant(
  key: CacheKey,
  variant: VerifiedSocialMediaVariant,
): void {
  const safe: VerifiedSocialMediaVariant = {
    ...variant,
    requestContext: stripRequestContextSecrets(variant.requestContext),
    alternatives: variant.alternatives?.slice(0, 6).map((v) => ({
      ...v, alternatives: undefined, requestContext: stripRequestContextSecrets(v.requestContext),
    })),
  };
  verifiedCache.set(key, {
    variant: safe,
    expiresAt: Date.now() + VERIFICATION_TTL_MS,
  });
  pruneCache();
}

export function joinOrStartVerification(
  key: CacheKey,
  start: (signal: AbortSignal) => Promise<VerifiedSocialMediaVariant | null>,
  callerSignal?: AbortSignal,
): { joined: boolean; promise: Promise<VerifiedSocialMediaVariant | null> } {
  const now = Date.now();
  const existing = inFlight.get(key);
  // A job every caller abandoned, or one that never settled, is not joined: this caller starts a fresh one.
  if (existing && !existing.controller.signal.aborted && now - existing.startedAt <= IN_FLIGHT_STALE_MS) {
    attachCaller(existing, callerSignal);
    return { joined: true, promise: existing.promise };
  }
  if (existing) {
    inFlight.delete(key);
  }
  pruneInFlight(now);
  const controller = new AbortController();
  const entry: InFlightEntry = {
    promise: Promise.resolve(null),
    controller,
    waiting: 0,
    pinned: false,
    startedAt: now,
  };
  // Deferred until the entry is installed (also avoids caller TDZ on `joined`).
  entry.promise = Promise.resolve()
    .then(() => start(controller.signal))
    .finally(() => {
      if (inFlight.get(key) === entry) inFlight.delete(key);
    });
  inFlight.set(key, entry);
  attachCaller(entry, callerSignal);
  return { joined: false, promise: entry.promise };
}

function attachCaller(entry: InFlightEntry, signal: AbortSignal | undefined): void {
  if (!signal) {
    entry.pinned = true;
    return;
  }
  if (!signal.aborted) {
    entry.waiting += 1;
    signal.addEventListener(
      'abort',
      () => {
        entry.waiting -= 1;
        abandonIfUnwanted(entry);
      },
      { once: true },
    );
  }
  abandonIfUnwanted(entry);
}

function abandonIfUnwanted(entry: InFlightEntry): void {
  if (!entry.pinned && entry.waiting <= 0) {
    entry.controller.abort();
  }
}

/** Drops stuck jobs; at the cap the oldest job makes room instead of every later verification being refused. */
function pruneInFlight(now: number): void {
  for (const [key, entry] of inFlight) {
    if (now - entry.startedAt > IN_FLIGHT_STALE_MS) {
      inFlight.delete(key);
    }
  }
  while (inFlight.size >= MAX_ENTRIES) {
    const oldest = inFlight.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    inFlight.delete(oldest);
  }
}

export function clearVerificationForTab(tabId: string): void {
  for (const key of [...verifiedCache.keys()]) {
    if (key.startsWith(`${tabId}::`)) {
      verifiedCache.delete(key);
    }
  }
  for (const [key, entry] of [...inFlight.entries()]) {
    if (key.startsWith(`${tabId}::`)) {
      entry.controller.abort();
      inFlight.delete(key);
    }
  }
}

export function clearVerificationForContext(input: {
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
}): void {
  const prefix = `${input.tabId}::${input.navigationEpoch}::${input.socialContextGeneration}::`;
  for (const key of [...verifiedCache.keys()]) {
    if (key.startsWith(prefix)) {
      verifiedCache.delete(key);
    }
  }
}

export function clearAllVerificationSessions(): void {
  verifiedCache.clear();
  for (const entry of inFlight.values()) {
    entry.controller.abort();
  }
  inFlight.clear();
}

function pruneCache(): void {
  if (verifiedCache.size <= MAX_ENTRIES) {
    return;
  }
  const now = Date.now();
  for (const [key, entry] of verifiedCache) {
    if (entry.expiresAt <= now) {
      verifiedCache.delete(key);
    }
  }
  while (verifiedCache.size > MAX_ENTRIES) {
    const first = verifiedCache.keys().next().value;
    if (!first) {
      break;
    }
    verifiedCache.delete(first);
  }
}

export { VERIFICATION_TTL_MS };
