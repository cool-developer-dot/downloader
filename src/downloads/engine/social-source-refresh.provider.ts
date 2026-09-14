/**
 * Phase 4C — narrow mid-transfer / retry source refresh boundary.
 *
 * Phase 1 calls this interface; the browser/media layer registers the
 * implementation. Workers must NOT import BrowserScreen or Zustand browser store.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';

export type SocialSourceRefreshReason =
  | 'PRE_HANDOFF'
  | 'RESUME_STALE'
  | 'MANUAL_RETRY'
  | 'AUTH_EXPIRED'
  | 'INVALID_RESOURCE'
  | 'FINAL_FILE_INVALID';

/** Stable correlation for social refresh — never includes signed query/cookies. */
export type SocialSourceRefreshIdentity = {
  contentIdentity: string;
  variantIdentity: string;
  tabId?: string | null;
  navigationEpoch?: number | null;
  socialContextGeneration?: number | null;
  pageUrl?: string | null;
};

export type ResolveFreshSocialSourceInput = {
  downloadId: string;
  downloadGeneration: number;
  priorSourceUrl: string;
  priorRequestContext: MediaRequestContext | null;
  identity: SocialSourceRefreshIdentity | null;
  reason: SocialSourceRefreshReason;
};

export type FreshSocialSourceResult =
  | {
      type: 'FRESH';
      sourceUrl: string;
      requestContext: MediaRequestContext;
      contentIdentity?: string;
      variantIdentity?: string;
    }
  | { type: 'NO_SOURCE'; reason?: string }
  | { type: 'STALE_CONTEXT'; reason?: string }
  | { type: 'UNSUPPORTED'; reason?: string };

export type SocialSourceRefreshProvider = {
  resolveFreshSource(
    input: ResolveFreshSocialSourceInput,
  ): Promise<FreshSocialSourceResult>;
};

let registeredProvider: SocialSourceRefreshProvider | null = null;

export function registerSocialSourceRefreshProvider(
  provider: SocialSourceRefreshProvider | null,
): void {
  registeredProvider = provider;
}

export function getSocialSourceRefreshProvider(): SocialSourceRefreshProvider | null {
  return registeredProvider;
}

export async function resolveFreshSocialSourceForDownload(
  input: ResolveFreshSocialSourceInput,
): Promise<FreshSocialSourceResult> {
  const provider = registeredProvider;
  if (!provider) {
    return { type: 'NO_SOURCE', reason: 'PROVIDER_UNREGISTERED' };
  }
  return provider.resolveFreshSource(input);
}
