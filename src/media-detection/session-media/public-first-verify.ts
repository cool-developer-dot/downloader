/**
 * Phase 6B — public-first verification orchestration helpers.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';

import {
  classifyAuthLikeFailure,
  isAuthLikeFailure,
  type AuthFailureInput,
} from './auth-failure.classifier';
import {
  buildPublicMediaRequestContext,
  buildSessionCookieMediaRequestContext,
} from './session-request-context';
import { shouldAttemptPublicFirst } from './session-bound-evidence';
import { logSessionMedia } from './session-media-diagnostics';
import type { SessionMediaScope } from './types';

export type PublicFirstVerifyPlan = {
  /** Contexts to try in order (length 1 or 2). */
  contexts: MediaRequestContext[];
  startedWithSession: boolean;
};

export async function planPublicFirstVerification(input: {
  mediaUrl: string;
  pageUrl: string;
  requiresCookies?: boolean;
  requiredHeaders?: {
    referer?: string;
    userAgent?: string;
    hasCookies?: boolean;
  } | null;
  scope: SessionMediaScope;
  signal?: AbortSignal;
}): Promise<PublicFirstVerifyPlan> {
  const base = {
    mediaUrl: input.mediaUrl,
    pageUrl: input.pageUrl,
    requiresCookies: Boolean(
      input.requiresCookies || input.requiredHeaders?.hasCookies,
    ),
    referer: input.requiredHeaders?.referer ?? input.pageUrl,
    userAgent: input.requiredHeaders?.userAgent ?? null,
    scope: input.scope,
  };

  if (shouldAttemptPublicFirst(base)) {
    const publicCtx = await buildPublicMediaRequestContext(base);
    return { contexts: [publicCtx], startedWithSession: false };
  }

  const sessionCtx = await buildSessionCookieMediaRequestContext({
    ...base,
    attachCookies: true,
  });
  logSessionMedia('session_context_available', {
    authMode: sessionCtx.authMode,
    cookiePresent: sessionCtx.hasCookies,
    tabId: input.scope.tabId,
    pageGeneration: input.scope.pageGeneration,
  });
  return { contexts: [sessionCtx], startedWithSession: true };
}

/**
 * After a public (or first) failure, decide whether a single session retry is allowed.
 */
export async function maybeBuildSessionRetryContext(input: {
  mediaUrl: string;
  pageUrl: string;
  requiresCookies?: boolean;
  requiredHeaders?: {
    referer?: string;
    userAgent?: string;
    hasCookies?: boolean;
  } | null;
  scope: SessionMediaScope;
  failure: AuthFailureInput;
  alreadyUsedSession: boolean;
}): Promise<MediaRequestContext | null> {
  if (input.alreadyUsedSession) {
    return null;
  }
  if (!isAuthLikeFailure(input.failure)) {
    return null;
  }

  logSessionMedia('public_verify_auth_required', {
    authLike: classifyAuthLikeFailure(input.failure),
    status: input.failure.status ?? null,
    tabId: input.scope.tabId,
    pageGeneration: input.scope.pageGeneration,
  });

  const sessionCtx = await buildSessionCookieMediaRequestContext({
    mediaUrl: input.mediaUrl,
    pageUrl: input.pageUrl,
    requiresCookies: true,
    referer: input.requiredHeaders?.referer ?? input.pageUrl,
    userAgent: input.requiredHeaders?.userAgent ?? null,
    attachCookies: true,
    scope: input.scope,
  });

  if (
    sessionCtx.authMode === 'AUTH_CONTEXT_UNAVAILABLE' &&
    !sessionCtx.hasCookies
  ) {
    logSessionMedia('authorization_unavailable', {
      cookiePresent: false,
      tabId: input.scope.tabId,
    });
    return sessionCtx;
  }

  logSessionMedia('session_context_available', {
    cookiePresent: sessionCtx.hasCookies,
    authMode: sessionCtx.authMode,
    tabId: input.scope.tabId,
  });
  return sessionCtx;
}

export { resolveAccessClassAfterFailure } from './auth-failure.classifier';
export type { AuthFailureInput };
