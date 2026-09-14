/**
 * Phase 6C — ephemeral download execution context (in-memory only).
 *
 * Separates persistable download metadata from session secrets.
 * Cookie/Authorization live only transiently when resolving per-target headers.
 */

import type { MediaAuthMode, MediaRequestContext } from '@/downloads/types/request-context';
import { stripRequestContextSecrets } from '@/media-detection/session-media/strip-secrets';
import type { SocialSourceRefreshIdentity } from './social-source-refresh.provider';

export type SessionCookieStrategy =
  | 'NONE'
  | 'COOKIE_MANAGER_PER_TARGET';

export type SessionAccessMode =
  | 'PUBLIC'
  | 'SESSION_BOUND_ACCESSIBLE'
  | 'AUTH_CONTEXT_UNAVAILABLE'
  | 'SESSION_EXPIRED'
  | 'PROTECTED_UNSUPPORTED';

export type HlsRequestKind = 'master' | 'child' | 'segment' | 'progressive' | 'redirect';

/** In-memory download session metadata — never persisted to disk. */
export type DownloadSessionMeta = {
  pageUrl: string | null;
  /**
   * Non-secret request metadata (Referer/UA flags). Cookie/Authorization stripped.
   * Live cookies are resolved per target via CookieManager.
   */
  requestContext: MediaRequestContext | null;
  detectedAt: number;
  refreshAttempted: boolean;
  socialIdentity: SocialSourceRefreshIdentity | null;
  streamType?: 'HLS' | 'PROGRESSIVE' | 'AUDIO' | 'DASH' | null;

  /** Phase 6C */
  accessMode: SessionAccessMode;
  cookieStrategy: SessionCookieStrategy;
  /** Opaque hash of session cookie material at handoff — never the cookie itself. */
  sessionCoherenceFingerprint: string | null;
  /** Original media/source URL used for coherence CookieManager reads. */
  coherenceCookieUrl: string | null;
  userAgent: string | null;
  referer: string | null;
  tabId: string | null;
  navigationEpoch: number | null;
  pageGeneration: number | null;
  mediaIdentity: string | null;
  authRetryBudget: number;
  createdAt: number;
};

const sessions = new Map<string, DownloadSessionMeta>();
const MAX_SESSIONS = 64;

function pruneIfNeeded(): void {
  if (sessions.size <= MAX_SESSIONS) {
    return;
  }
  const oldest = [...sessions.entries()].sort(
    (a, b) => a[1].createdAt - b[1].createdAt,
  );
  while (sessions.size > MAX_SESSIONS && oldest.length > 0) {
    const next = oldest.shift();
    if (!next) {
      break;
    }
    sessions.delete(next[0]);
  }
}

export function setDownloadSessionMeta(
  downloadId: string,
  meta: DownloadSessionMeta,
): void {
  sessions.set(downloadId, meta);
  pruneIfNeeded();
}

export function getDownloadSessionMeta(downloadId: string): DownloadSessionMeta | null {
  return sessions.get(downloadId) ?? null;
}

export function markDownloadRefreshAttempted(downloadId: string): void {
  const existing = sessions.get(downloadId);
  if (!existing) {
    return;
  }
  sessions.set(downloadId, { ...existing, refreshAttempted: true });
}

export function consumeAuthRetryBudget(downloadId: string): boolean {
  const existing = sessions.get(downloadId);
  if (!existing || existing.authRetryBudget <= 0) {
    return false;
  }
  sessions.set(downloadId, {
    ...existing,
    authRetryBudget: existing.authRetryBudget - 1,
  });
  return true;
}

export function clearDownloadSessionMeta(downloadId: string): void {
  sessions.delete(downloadId);
}

export function clearAllDownloadSessionMeta(): void {
  sessions.clear();
}

export function hasDownloadSessionMeta(downloadId: string): boolean {
  return sessions.has(downloadId);
}

export function isSessionBoundMeta(meta: DownloadSessionMeta | null | undefined): boolean {
  if (!meta) {
    return false;
  }
  return (
    meta.accessMode === 'SESSION_BOUND_ACCESSIBLE' ||
    meta.cookieStrategy === 'COOKIE_MANAGER_PER_TARGET' ||
    meta.requestContext?.authMode === 'SESSION_COOKIE' ||
    meta.requestContext?.authMode === 'SESSION_PLUS_REFERER' ||
    Boolean(meta.requestContext?.cookiesRequired)
  );
}

function resolveAccessMode(
  requestContext: MediaRequestContext | null | undefined,
): SessionAccessMode {
  const mode = requestContext?.authMode;
  if (mode === 'PUBLIC' || !mode) {
    if (requestContext?.hasCookies || requestContext?.cookiesRequired) {
      return 'SESSION_BOUND_ACCESSIBLE';
    }
    return 'PUBLIC';
  }
  if (mode === 'SESSION_COOKIE' || mode === 'SESSION_PLUS_REFERER') {
    return 'SESSION_BOUND_ACCESSIBLE';
  }
  if (mode === 'AUTH_CONTEXT_UNAVAILABLE') {
    return 'AUTH_CONTEXT_UNAVAILABLE';
  }
  if (mode === 'UNSUPPORTED') {
    return 'PROTECTED_UNSUPPORTED';
  }
  return 'PUBLIC';
}

/**
 * FNV-1a 32-bit hash — opaque, non-reversible fingerprint of cookie material.
 * Never logs or stores the input string.
 */
export function fingerprintSessionMaterial(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) {
    return null;
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sfp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Cookie name list only — never values — for diagnostics/tests. */
export function extractCookieNames(cookieHeader: string | null | undefined): string[] {
  if (!cookieHeader?.trim()) {
    return [];
  }
  return cookieHeader
    .split(';')
    .map((part) => part.trim().split('=')[0]?.trim() ?? '')
    .filter(Boolean)
    .sort();
}

export function buildSessionMetaFromContext(
  requestContext: MediaRequestContext | null | undefined,
  socialIdentity?: SocialSourceRefreshIdentity | null,
  streamType?: 'HLS' | 'PROGRESSIVE' | 'AUDIO' | 'DASH' | null,
  options?: {
    coherenceCookieUrl?: string | null;
    sessionCoherenceFingerprint?: string | null;
  },
): DownloadSessionMeta {
  const accessMode = resolveAccessMode(requestContext);
  const sessionBound = accessMode === 'SESSION_BOUND_ACCESSIBLE';
  const rawCookie = requestContext?.headers?.Cookie ?? null;
  const fingerprint =
    options?.sessionCoherenceFingerprint ??
    (sessionBound ? fingerprintSessionMaterial(rawCookie) : null);

  const safeContext = stripRequestContextSecrets(requestContext);

  return {
    pageUrl: requestContext?.pageUrl ?? socialIdentity?.pageUrl ?? null,
    requestContext: safeContext
      ? {
          ...safeContext,
          // Preserve auth classification without secrets.
          authMode: (requestContext?.authMode ??
            (sessionBound ? 'SESSION_COOKIE' : 'PUBLIC')) as MediaAuthMode,
          cookiesRequired: Boolean(requestContext?.cookiesRequired || sessionBound),
          hasCookies: false,
        }
      : null,
    detectedAt: requestContext?.capturedAt ?? Date.now(),
    refreshAttempted: false,
    socialIdentity: socialIdentity ?? null,
    streamType: streamType ?? null,
    accessMode,
    cookieStrategy: sessionBound ? 'COOKIE_MANAGER_PER_TARGET' : 'NONE',
    sessionCoherenceFingerprint: fingerprint,
    coherenceCookieUrl:
      options?.coherenceCookieUrl ??
      (sessionBound
        ? requestContext?.pageUrl ?? socialIdentity?.pageUrl ?? null
        : null),
    userAgent: requestContext?.userAgent ?? null,
    referer: requestContext?.referer ?? null,
    tabId: requestContext?.tabId ?? null,
    navigationEpoch: requestContext?.navigationEpoch ?? null,
    pageGeneration: requestContext?.pageGeneration ?? null,
    mediaIdentity: requestContext?.mediaIdentity ?? null,
    authRetryBudget: sessionBound ? 1 : 0,
    createdAt: Date.now(),
  };
}

/** Test/diagnostics — active ephemeral session count. */
export function downloadSessionMetaSize(): number {
  return sessions.size;
}
