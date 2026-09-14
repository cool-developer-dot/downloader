import type {
  MediaRequestContext,
  MediaRequestContextInput,
} from '@/downloads/types/request-context';

import {
  buildPublicMediaRequestContext,
  buildSessionAwareMediaRequestContext,
  buildSessionCookieMediaRequestContext,
} from '../session-media/session-request-context';
import { evidenceImpliesSessionBound } from '../session-media/session-bound-evidence';

/**
 * Builds a normalized in-memory request context for analyze/download handoff.
 *
 * Phase 6B:
 * - Cookie attachment is mediaUrl-scoped via CookieManager only
 * - Never copies page-host cookies onto unrelated media hosts
 * - PUBLIC by default unless cookies are required / session-bound evidence
 *
 * Import graph: leaf session builders only — never browser store / social-source.
 */
export async function buildMediaRequestContext(
  input: MediaRequestContextInput,
): Promise<MediaRequestContext> {
  const scope = {
    tabId: input.tabId ?? undefined,
    navigationEpoch: input.navigationEpoch ?? undefined,
    pageGeneration: input.pageGeneration ?? undefined,
    mediaIdentity: input.mediaIdentity ?? undefined,
  };

  if (input.authMode === 'PUBLIC') {
    return buildPublicMediaRequestContext({
      ...input,
      scope,
      attachCookies: false,
    });
  }

  const sessionBound =
    evidenceImpliesSessionBound({
      pageUrl: input.pageUrl,
      requiresCookies: input.requiresCookies,
    }) || Boolean(input.requiresCookies);

  if (sessionBound || input.authMode === 'SESSION_COOKIE' || input.authMode === 'SESSION_PLUS_REFERER') {
    return buildSessionCookieMediaRequestContext({
      ...input,
      scope,
      attachCookies: true,
    });
  }

  return buildPublicMediaRequestContext({
    ...input,
    scope,
    attachCookies: false,
  });
}

export function buildMediaRequestContextSync(
  input: MediaRequestContextInput,
): Omit<MediaRequestContext, 'hasCookies'> & { hasCookies: boolean } {
  // Sync path never touches CookieManager — PUBLIC headers only.
  const pageUrlRaw = input.pageUrl?.trim() || null;
  const referer =
    input.referer?.trim() ||
    (pageUrlRaw && pageUrlRaw.startsWith('http') ? pageUrlRaw : null);

  const headers: Record<string, string> = {
    Accept: '*/*',
  };
  if (referer) {
    headers.Referer = referer;
  }
  if (input.userAgent?.trim()) {
    headers['User-Agent'] = input.userAgent.trim().slice(0, 512);
  }

  return {
    pageUrl: pageUrlRaw,
    originalPageUrl: input.originalPageUrl ?? pageUrlRaw,
    redirectChain: input.redirectChain,
    referer,
    userAgent: input.userAgent?.trim() || null,
    cookiesRequired: Boolean(input.requiresCookies),
    hasCookies: false,
    headers,
    capturedAt: Date.now(),
    authMode: 'PUBLIC',
    tabId: input.tabId ?? null,
    navigationEpoch: input.navigationEpoch ?? null,
    pageGeneration: input.pageGeneration ?? null,
    mediaIdentity: input.mediaIdentity ?? null,
  };
}

/** Convenience for detection overlay / 4B/5B — async cookie attach when required. */
export async function buildRequestContextFromDetectedMedia(input: {
  mediaUrl: string;
  pageUrl?: string | null;
  requiresCookies?: boolean;
  requiredHeaders?: { referer?: string; userAgent?: string; hasCookies?: boolean } | null;
  tabId?: string | null;
  navigationEpoch?: number | null;
  pageGeneration?: number | null;
  mediaIdentity?: string | null;
  authMode?: MediaRequestContextInput['authMode'];
}): Promise<MediaRequestContext> {
  return buildMediaRequestContext({
    mediaUrl: input.mediaUrl,
    pageUrl: input.pageUrl ?? input.requiredHeaders?.referer ?? null,
    userAgent: input.requiredHeaders?.userAgent ?? null,
    requiresCookies: Boolean(
      input.requiresCookies || input.requiredHeaders?.hasCookies,
    ),
    referer: input.requiredHeaders?.referer ?? input.pageUrl ?? null,
    authMode: input.authMode,
    tabId: input.tabId,
    navigationEpoch: input.navigationEpoch,
    pageGeneration: input.pageGeneration,
    mediaIdentity: input.mediaIdentity,
  });
}

export { buildSessionAwareMediaRequestContext };
