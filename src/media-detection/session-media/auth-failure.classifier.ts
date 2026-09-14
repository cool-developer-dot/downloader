/**
 * Phase 6B — classify probe failures as auth-like vs not.
 * Never treats all failures as "needs cookie".
 */

import type { AuthLikeFailureKind } from './types';

export type AuthFailureInput = {
  status?: number | null;
  mimeType?: string | null;
  signatureKind?: string | null;
  rejectionReason?: string | null;
  /** Final URL after redirects — used only for scheme/host checks, never logged raw. */
  finalUrl?: string | null;
};

const LOGIN_HTML_HINTS =
  /login|sign[\s_-]?in|authenticate|oauth|sso|passwd|password|account\/login/i;

/**
 * True when failure evidence suggests legitimate session may be required.
 * 404 / invalid container / DRM / segment are NEVER auth-like.
 */
export function classifyAuthLikeFailure(input: AuthFailureInput): AuthLikeFailureKind {
  const reason = (input.rejectionReason ?? '').toUpperCase();
  if (
    reason === 'SEGMENT_RESOURCE' ||
    reason === 'INIT_SEGMENT' ||
    reason === 'MEDIA_FRAGMENT' ||
    reason === 'NOT_MEDIA' ||
    reason === 'DRM_UNSUPPORTED' ||
    reason === 'DASH_UNSUPPORTED' ||
    reason === 'BLOB_ONLY' ||
    reason === 'EXPIRED_SOURCE' ||
    reason === 'MANIFEST_INVALID' ||
    reason === 'VIDEO_ONLY_UNSUPPORTED' ||
    reason === 'UNSUPPORTED_TRANSPORT'
  ) {
    return 'not_auth_like';
  }

  if (input.signatureKind === 'html' || reason === 'HTML_RESPONSE') {
    return 'login_html';
  }

  const status = input.status ?? null;
  if (status === 401) {
    return 'http_401';
  }
  if (status === 403) {
    return 'http_403';
  }
  if (status === 404 || status === 410) {
    return 'not_auth_like';
  }
  if (status != null && status >= 500) {
    return 'not_auth_like';
  }

  if (reason === 'AUTH_RESPONSE' || reason === 'AUTH_REQUIRED') {
    return 'session_required';
  }

  const mime = (input.mimeType ?? '').toLowerCase();
  if (mime.includes('text/html') && LOGIN_HTML_HINTS.test(input.finalUrl ?? '')) {
    return 'login_html';
  }

  return 'not_auth_like';
}

export function isAuthLikeFailure(input: AuthFailureInput): boolean {
  return classifyAuthLikeFailure(input) !== 'not_auth_like';
}

/**
 * After a session-aware probe still fails auth-like → session expired / unavailable.
 */
export function classifyPostSessionFailure(
  input: AuthFailureInput,
): 'SESSION_EXPIRED' | 'AUTH_CONTEXT_UNAVAILABLE' | 'PROTECTED_UNSUPPORTED' | null {
  if (!isAuthLikeFailure(input)) {
    return null;
  }
  const kind = classifyAuthLikeFailure(input);
  if (kind === 'login_html' || kind === 'http_401' || kind === 'http_403') {
    return 'SESSION_EXPIRED';
  }
  return 'AUTH_CONTEXT_UNAVAILABLE';
}

export function resolveAccessClassAfterFailure(input: {
  failure: AuthFailureInput;
  usedSession: boolean;
  sessionHadCookies: boolean;
}):
  | 'PUBLIC'
  | 'SESSION_BOUND_ACCESSIBLE'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'PROTECTED_UNSUPPORTED' {
  if (!input.usedSession) {
    if (isAuthLikeFailure(input.failure)) {
      return input.sessionHadCookies
        ? 'SESSION_EXPIRED'
        : 'AUTH_CONTEXT_UNAVAILABLE';
    }
    return 'PROTECTED_UNSUPPORTED';
  }
  const post = classifyPostSessionFailure(input.failure);
  if (post) {
    return post;
  }
  return 'PROTECTED_UNSUPPORTED';
}
