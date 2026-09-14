/**
 * Normalized safe request context for media detection → download handoff.
 * Cookie values are held in memory only — never logged or persisted.
 *
 * Phase 6B: authMode + generation scope classify public vs session-bound access.
 * Authorization is never auto-captured.
 */

export type MediaAuthMode =
  | 'PUBLIC'
  | 'SESSION_COOKIE'
  | 'SESSION_PLUS_REFERER'
  | 'AUTH_HEADER'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'UNSUPPORTED';

export type MediaRequestContext = {
  /** Canonical public page URL (after share-link resolution when available). */
  pageUrl: string | null;
  /** Original URL entered or observed before resolution. */
  originalPageUrl?: string | null;
  /** Bounded redirect chain for page URL resolution (URLs only). */
  redirectChain?: readonly string[];
  referer: string | null;
  userAgent: string | null;
  cookiesRequired: boolean;
  /** True when Cookie header was attached (value never exposed). */
  hasCookies: boolean;
  /** Safe outbound headers for analyze/download — Cookie value never logged. */
  headers: Record<string, string>;
  capturedAt: number;
  /** Phase 6B — how this context was built. */
  authMode?: MediaAuthMode;
  /** Owning tab — generation-scoped; never a global host cache key alone. */
  tabId?: string | null;
  navigationEpoch?: number | null;
  pageGeneration?: number | null;
  mediaIdentity?: string | null;
};

export type MediaRequestContextInput = {
  mediaUrl: string;
  pageUrl?: string | null;
  originalPageUrl?: string | null;
  redirectChain?: readonly string[];
  userAgent?: string | null;
  requiresCookies?: boolean;
  /** Pre-built headers from detection (Referer/User-Agent flags only). */
  referer?: string | null;
  authMode?: MediaAuthMode;
  tabId?: string | null;
  navigationEpoch?: number | null;
  pageGeneration?: number | null;
  mediaIdentity?: string | null;
};

export type AnalyzeRequestOptions = {
  signal?: AbortSignal;
  referer?: string | null;
  userAgent?: string | null;
  requestContext?: MediaRequestContext | null;
};

export type DownloadRequestOptions = {
  requestContext?: MediaRequestContext | null;
};
