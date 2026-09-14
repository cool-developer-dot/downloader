/**
 * Fresh executable social source provider — bounded refresh for SAME content/variant.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';
import { isLikelyExpiredMediaUrl } from '../services/expiring-url.service';
import { buildRequestContextFromDetectedMedia } from '../services/request-context.service';
import { useMediaDetectionStore } from '../stores';
import { socialPageContextStore } from '../social';
import { isSameDocumentUrl } from '../utils';
import { logSocialSource } from './social-source-diagnostics';
import {
  findFresherExecutableForVariant,
  verifySocialSourceCandidate,
} from './social-source-reliability.service';
import { preserveExecutableUrl, sameResourceFamily } from './resource-identity';
import type { FreshExecutableSocialSourceResult } from './types';

const MAX_REFRESH_ATTEMPTS = 2;

const refreshAttempts = new Map<string, number>();

function attemptKey(input: {
  tabId: string;
  contentIdentity: string;
  variantIdentity: string;
}): string {
  return `${input.tabId}::${input.contentIdentity}::${input.variantIdentity}`;
}

/**
 * Return a fresh executable URL for the SAME content + variant identity.
 * No polling loops — bounded attempts only.
 */
export async function getFreshExecutableSocialSource(input: {
  tabId: string;
  navigationEpoch: number;
  socialContextGeneration: number;
  contentIdentity: string;
  variantIdentity: string;
  previousUrl: string;
  pageUrl: string;
  requestContext?: MediaRequestContext | null;
  signal?: AbortSignal;
}): Promise<FreshExecutableSocialSourceResult> {
  const ctx = socialPageContextStore.get(input.tabId);
  if (!ctx) {
    return { outcome: 'STALE_CONTEXT', reason: 'STALE_SOCIAL_CONTEXT' };
  }
  if (
    ctx.navigationEpoch !== input.navigationEpoch ||
    ctx.contextGeneration !== input.socialContextGeneration
  ) {
    logSocialSource('stale_verification_ignored', {
      tabId: input.tabId,
      reason: 'STALE_SOCIAL_CONTEXT',
      contentIdentity: input.contentIdentity,
    });
    return { outcome: 'STALE_CONTEXT', reason: 'STALE_SOCIAL_CONTEXT' };
  }

  const key = attemptKey(input);
  const attempts = refreshAttempts.get(key) ?? 0;
  if (attempts >= MAX_REFRESH_ATTEMPTS) {
    logSocialSource('refresh_failed', {
      tabId: input.tabId,
      contentIdentity: input.contentIdentity,
      reason: 'NO_FRESH_SOURCE',
    });
    return { outcome: 'NO_SOURCE', reason: 'NO_FRESH_SOURCE' };
  }

  logSocialSource('freshness_check', {
    tabId: input.tabId,
    contentIdentity: input.contentIdentity,
    variantId: input.variantIdentity,
  });

  const previous = preserveExecutableUrl(input.previousUrl);
  if (!isLikelyExpiredMediaUrl(previous, Date.now() - 1_000)) {
    // Still appears fresh — re-verify once.
    const storeMedia = useMediaDetectionStore.getState().detectedMedia.find(
      (m) => (m.finalUrl || m.url) === previous,
    );
    if (storeMedia) {
      const requestContext =
        input.requestContext ??
        (await buildRequestContextFromDetectedMedia({
          mediaUrl: previous,
          pageUrl: input.pageUrl,
          requiresCookies: storeMedia.requiresCookies,
          requiredHeaders: storeMedia.requiredHeaders,
        }));
      const verified = await verifySocialSourceCandidate(storeMedia, {
        pageUrl: input.pageUrl,
        requestContext,
        signal: input.signal,
      });
      if (verified.ok) {
        return {
          outcome: 'FRESH',
          executableUrl: preserveExecutableUrl(verified.verification.finalUrl),
          requestContext,
          variantId: input.variantIdentity,
          resourceIdentity: input.variantIdentity,
          contentIdentity: input.contentIdentity,
        };
      }
    }
  }

  refreshAttempts.set(key, attempts + 1);
  logSocialSource('refresh_started', {
    tabId: input.tabId,
    contentIdentity: input.contentIdentity,
    variantId: input.variantIdentity,
  });

  const candidates = useMediaDetectionStore.getState().detectedMedia.filter(
    (media) =>
      media.pageUrl &&
      isSameDocumentUrl(media.pageUrl, input.pageUrl) &&
      !media.url.startsWith('blob:'),
  );

  const fresher = findFresherExecutableForVariant({
    contentIdentity: input.contentIdentity,
    resourceIdentity: input.variantIdentity,
    previousUrl: previous,
    candidates,
  });

  if (!fresher) {
    // Try any same-path-family candidate including previous if newly observed.
    const family = candidates.find(
      (m) =>
        sameResourceFamily(m.finalUrl || m.url, previous) &&
        (m.finalUrl || m.url) !== previous,
    );
    if (!family) {
      logSocialSource('refresh_failed', {
        tabId: input.tabId,
        reason: 'NO_FRESH_SOURCE',
        contentIdentity: input.contentIdentity,
      });
      return { outcome: 'NO_SOURCE', reason: 'NO_FRESH_SOURCE' };
    }
    return verifyAndReturn(family, input);
  }

  return verifyAndReturn(fresher, input);
}

async function verifyAndReturn(
  media: import('../types').DetectedMedia,
  input: {
    tabId: string;
    contentIdentity: string;
    variantIdentity: string;
    pageUrl: string;
    requestContext?: MediaRequestContext | null;
    signal?: AbortSignal;
  },
): Promise<FreshExecutableSocialSourceResult> {
  const executableUrl = preserveExecutableUrl(media.finalUrl || media.url);
  const requestContext =
    input.requestContext ??
    (await buildRequestContextFromDetectedMedia({
      mediaUrl: executableUrl,
      pageUrl: input.pageUrl,
      requiresCookies: media.requiresCookies,
      requiredHeaders: media.requiredHeaders,
    }));

  const verified = await verifySocialSourceCandidate(media, {
    pageUrl: input.pageUrl,
    requestContext,
    signal: input.signal,
  });

  if (!verified.ok) {
    logSocialSource('refresh_failed', {
      tabId: input.tabId,
      reason: verified.reason,
      contentIdentity: input.contentIdentity,
    });
    if (verified.reason === 'VIDEO_ONLY_UNSUPPORTED') {
      return { outcome: 'UNSUPPORTED', reason: verified.reason };
    }
    return { outcome: 'NO_SOURCE', reason: verified.reason };
  }

  logSocialSource('refresh_succeeded', {
    tabId: input.tabId,
    contentIdentity: input.contentIdentity,
    variantId: input.variantIdentity,
  });

  return {
    outcome: 'FRESH',
    executableUrl: preserveExecutableUrl(verified.verification.finalUrl),
    requestContext,
    variantId: input.variantIdentity,
    resourceIdentity: input.variantIdentity,
    contentIdentity: input.contentIdentity,
  };
}

export function clearSocialSourceRefreshAttempts(tabId?: string): void {
  if (!tabId) {
    refreshAttempts.clear();
    return;
  }
  for (const key of [...refreshAttempts.keys()]) {
    if (key.startsWith(`${tabId}::`)) {
      refreshAttempts.delete(key);
    }
  }
}

export { MAX_REFRESH_ATTEMPTS };
