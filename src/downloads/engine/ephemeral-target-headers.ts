/**
 * Phase 6C — resolve minimum request headers for an actual network target URL.
 *
 * CookieManager.getCookie(targetUrl) is authoritative.
 * Never copy parent-host Cookie onto unrelated child/segment hosts.
 */

import { filterSessionMediaHeaders } from '@/media-detection/session-media/request-header-policy';
import { isSafeMediaUrl } from '@/media-detection/utils';

import { DownloadEngineError } from './errors';
import {
  consumeAuthRetryBudget,
  fingerprintSessionMaterial,
  getDownloadSessionMeta,
  isSessionBoundMeta,
  type DownloadSessionMeta,
  type HlsRequestKind,
} from './download-session-meta';
import { logSessionDownload } from './session-download-diagnostics';

export type ResolveTargetHeadersInput = {
  downloadId: string;
  targetUrl: string;
  requestKind: HlsRequestKind;
  parentUrl?: string | null;
  /** When true, verify session coherence against handoff fingerprint. */
  checkCoherence?: boolean;
  /** Test/injection hook — defaults to CookieManager bridge. */
  cookieReader?: (url: string) => Promise<string | null>;
};

export type ResolvedTargetHeaders = {
  headers: Record<string, string>;
  cookiePresent: boolean;
  accessMode: DownloadSessionMeta['accessMode'];
  cookieStrategy: DownloadSessionMeta['cookieStrategy'];
};

async function defaultCookieReader(url: string): Promise<string | null> {
  const { getSessionCookiesForUrl } = await import(
    '@/media-detection/adapters/cookie-bridge.adapter'
  );
  return getSessionCookiesForUrl(url);
}

function baseHeadersFromMeta(meta: DownloadSessionMeta): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: '*/*',
  };
  if (meta.referer && isSafeMediaUrl(meta.referer)) {
    headers.Referer = meta.referer;
  } else if (meta.pageUrl && isSafeMediaUrl(meta.pageUrl)) {
    headers.Referer = meta.pageUrl;
  }
  if (meta.userAgent?.trim()) {
    headers['User-Agent'] = meta.userAgent.trim().slice(0, 512);
  } else if (meta.requestContext?.userAgent?.trim()) {
    headers['User-Agent'] = meta.requestContext.userAgent.trim().slice(0, 512);
  }
  return filterSessionMediaHeaders(headers, { allowAuthorization: false });
}

/**
 * Session coherence: current CookieManager material for the coherence URL
 * must still fingerprint-match the handoff session.
 */
export async function assertSessionCoherence(
  meta: DownloadSessionMeta,
  cookieReader: (url: string) => Promise<string | null> = defaultCookieReader,
): Promise<void> {
  if (!meta.sessionCoherenceFingerprint || !meta.coherenceCookieUrl) {
    return;
  }
  if (!isSafeMediaUrl(meta.coherenceCookieUrl)) {
    return;
  }
  const current = await cookieReader(meta.coherenceCookieUrl);
  const nextFp = fingerprintSessionMaterial(current);
  if (nextFp !== meta.sessionCoherenceFingerprint) {
    logSessionDownload('session_changed', {
      downloadId: null,
      cookiePresent: Boolean(current),
    });
    throw new DownloadEngineError(
      'SESSION_CHANGED',
      'Your website account changed. Open the website and try again.',
    );
  }
}

/**
 * Canonical per-target header resolver for progressive + HLS.
 */
export async function resolveEphemeralHeadersForTarget(
  input: ResolveTargetHeadersInput,
): Promise<ResolvedTargetHeaders> {
  const meta = getDownloadSessionMeta(input.downloadId);
  const targetUrl = input.targetUrl.trim();

  if (!meta) {
    // Public / legacy jobs may run without registry — empty session headers.
    return {
      headers: {},
      cookiePresent: false,
      accessMode: 'PUBLIC',
      cookieStrategy: 'NONE',
    };
  }

  const base = baseHeadersFromMeta(meta);

  if (!isSessionBoundMeta(meta) || meta.cookieStrategy === 'NONE') {
    logSessionDownload('target_context_resolved', {
      downloadId: input.downloadId,
      requestKind: input.requestKind,
      cookiePresent: false,
      accessMode: meta.accessMode,
    });
    return {
      headers: base,
      cookiePresent: false,
      accessMode: meta.accessMode,
      cookieStrategy: meta.cookieStrategy,
    };
  }

  if (!isSafeMediaUrl(targetUrl)) {
    throw new DownloadEngineError('INVALID_RESOURCE', 'Download source is not a valid URL.');
  }

  const readCookies = input.cookieReader ?? defaultCookieReader;

  if (input.checkCoherence) {
    await assertSessionCoherence(meta, readCookies);
  }

  // CRITICAL: cookies for THIS target URL only — never parent Cookie reuse.
  const cookieHeader = await readCookies(targetUrl);
  const headers = { ...base };
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }

  const safe = filterSessionMediaHeaders(headers, { allowAuthorization: false });

  logSessionDownload(
    input.requestKind === 'master' ||
      input.requestKind === 'child' ||
      input.requestKind === 'segment'
      ? 'hls_target_context_resolved'
      : 'target_context_resolved',
    {
      downloadId: input.downloadId,
      requestKind: input.requestKind,
      cookiePresent: Boolean(cookieHeader),
      accessMode: meta.accessMode,
      parentHostDiffers: Boolean(
        input.parentUrl &&
          (() => {
            try {
              return (
                new URL(input.parentUrl).hostname !== new URL(targetUrl).hostname
              );
            } catch {
              return false;
            }
          })(),
      ),
    },
  );

  return {
    headers: safe,
    cookiePresent: Boolean(cookieHeader),
    accessMode: meta.accessMode,
    cookieStrategy: meta.cookieStrategy,
  };
}

/**
 * When session-bound meta is missing after process death / restart.
 */
export function assertSessionBoundExecutionContext(
  downloadId: string,
  requestContext: {
    cookiesRequired?: boolean;
    authMode?: string | null;
    hasCookies?: boolean;
  } | null | undefined,
): void {
  const meta = getDownloadSessionMeta(downloadId);
  const needsSession =
    isSessionBoundMeta(meta) ||
    Boolean(
      requestContext?.cookiesRequired ||
        requestContext?.hasCookies ||
        requestContext?.authMode === 'SESSION_COOKIE' ||
        requestContext?.authMode === 'SESSION_PLUS_REFERER',
    );

  if (!needsSession) {
    return;
  }

  if (!meta) {
    logSessionDownload('execution_context_missing', { downloadId });
    throw new DownloadEngineError(
      'SESSION_CONTEXT_LOST',
      'This authenticated download needs the active website session. Open the website and retry.',
    );
  }
}

/**
 * Bounded auth recovery: at most one CookieManager re-resolution per download.
 * Returns fresh headers when retry is allowed; otherwise throws SESSION_EXPIRED.
 */
export async function tryBoundedAuthContextRetry(input: {
  downloadId: string;
  targetUrl: string;
  requestKind: HlsRequestKind;
  parentUrl?: string | null;
  cookieReader?: (url: string) => Promise<string | null>;
}): Promise<ResolvedTargetHeaders> {
  const allowed = consumeAuthRetryBudget(input.downloadId);
  if (!allowed) {
    logSessionDownload('auth_retry_exhausted', {
      downloadId: input.downloadId,
      requestKind: input.requestKind,
    });
    throw new DownloadEngineError(
      'SESSION_EXPIRED',
      'Your website session expired. Open the website and try again.',
    );
  }
  logSessionDownload('auth_retry_started', {
    downloadId: input.downloadId,
    requestKind: input.requestKind,
  });
  return resolveEphemeralHeadersForTarget({
    ...input,
    checkCoherence: true,
  });
}

export function isAuthDeniedError(error: unknown): boolean {
  if (error instanceof DownloadEngineError) {
    return (
      error.code === 'AUTH_ERROR' ||
      error.httpStatus === 401 ||
      error.httpStatus === 403
    );
  }
  return false;
}
