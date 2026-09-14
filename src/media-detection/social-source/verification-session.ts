/**
 * Bounded ephemeral verification cache + in-flight dedupe.
 * Scoped by tab + navigation + social context + content + resource identity.
 *
 * Phase 6B: cached variants never retain Cookie/Authorization header values.
 */

import { stableResourcePath } from './resource-identity';
import type { VerifiedSocialMediaVariant } from './types';
import { stripRequestContextSecrets } from '../session-media/strip-secrets';

type CacheKey = string;

type InFlightEntry = {
  promise: Promise<VerifiedSocialMediaVariant | null>;
};

type CacheEntry = {
  variant: VerifiedSocialMediaVariant;
  expiresAt: number;
};

const VERIFICATION_TTL_MS = 45_000;
const MAX_ENTRIES = 48;

const inFlight = new Map<CacheKey, InFlightEntry>();
const verifiedCache = new Map<CacheKey, CacheEntry>();

export function buildVerificationCacheKey(input: {
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
  contentIdentity: string;
  executableUrl: string;
}): CacheKey {
  const path = stableResourcePath(input.executableUrl) ?? input.executableUrl.slice(0, 120);
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
  };
  verifiedCache.set(key, {
    variant: safe,
    expiresAt: Date.now() + VERIFICATION_TTL_MS,
  });
  pruneCache();
}

export function joinOrStartVerification(
  key: CacheKey,
  start: () => Promise<VerifiedSocialMediaVariant | null>,
): { joined: boolean; promise: Promise<VerifiedSocialMediaVariant | null> } {
  const existing = inFlight.get(key);
  if (existing) {
    return { joined: true, promise: existing.promise };
  }
  const promise = start().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, { promise });
  return { joined: false, promise };
}

export function clearVerificationForTab(tabId: string): void {
  for (const key of [...verifiedCache.keys()]) {
    if (key.startsWith(`${tabId}::`)) {
      verifiedCache.delete(key);
    }
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(`${tabId}::`)) {
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
