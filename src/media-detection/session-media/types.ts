/**
 * Phase 6B — session-aware media access classification types.
 * Secrets stay ephemeral; authMode is non-sensitive metadata.
 */

export type { MediaAuthMode } from '@/downloads/types/request-context';

export type SessionMediaAccessClass =
  | 'PUBLIC'
  | 'SESSION_BOUND_ACCESSIBLE'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'PROTECTED_UNSUPPORTED';

export type AuthLikeFailureKind =
  | 'http_401'
  | 'http_403'
  | 'login_html'
  | 'auth_redirect'
  | 'session_required'
  | 'not_auth_like';

export type SessionMediaScope = {
  tabId: string;
  navigationEpoch: number;
  pageGeneration: number;
  mediaIdentity: string;
};
