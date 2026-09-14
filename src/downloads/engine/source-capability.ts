/**
 * CDN transfer capability — conservative defaults for social media hosts.
 * Correctness first; multi-range only when proven safe.
 */

import type { MediaRequestContext } from '@/downloads/types/request-context';
import {
  hostOf,
  matchesPlatformCdn,
  PLATFORM_CDN_HOSTS,
} from '@/media-detection/platform/cdn-hosts';
import type { PlatformPageKind } from '@/media-detection/platform/types';

import { buildDownloadHeaders } from './download-headers';
import { assertSessionBoundExecutionContext } from './ephemeral-target-headers';
import { DownloadEngineError } from './errors';

export type SocialCdnKind = Exclude<PlatformPageKind, 'generic'> | null;

/** Centralized CDN transfer capability — avoid host-specific if-statements in workers. */
export type SourceCapability = {
  supportsRange: boolean;
  supportsMultiRange: boolean;
  requiresSessionContext: boolean;
  preferSingleStream: boolean;
  supportsResume: boolean;
};

const SOCIAL_DEFAULT: SourceCapability = {
  supportsRange: true,
  supportsMultiRange: false,
  requiresSessionContext: true,
  preferSingleStream: true,
  supportsResume: false,
};

const GENERIC_DEFAULT: SourceCapability = {
  supportsRange: true,
  supportsMultiRange: true,
  requiresSessionContext: false,
  preferSingleStream: false,
  supportsResume: true,
};

export function getSourceCapability(
  sourceUrl: string,
  requestContext?: MediaRequestContext | null,
  platformOs = 'android',
): SourceCapability {
  if (isSocialCdnUrl(sourceUrl)) {
    return SOCIAL_DEFAULT;
  }
  if (
    requestContext?.cookiesRequired ||
    requestContext?.hasCookies ||
    requestContext?.referer?.trim()
  ) {
    return {
      ...GENERIC_DEFAULT,
      supportsMultiRange: false,
      requiresSessionContext: true,
      preferSingleStream: true,
      supportsResume: platformOs === 'android',
    };
  }
  return {
    ...GENERIC_DEFAULT,
    supportsMultiRange: shouldUseMultiRangeForSource(
      sourceUrl,
      requestContext,
      platformOs,
    ),
  };
}

export function detectSocialCdnKind(sourceUrl: string): SocialCdnKind {
  const host = hostOf(sourceUrl);
  if (!host) {
    return null;
  }
  for (const platform of ['tiktok', 'instagram'] as const) {
    if (matchesPlatformCdn(sourceUrl, platform)) {
      return platform;
    }
  }
  return null;
}

export function isSocialCdnUrl(sourceUrl: string): boolean {
  return detectSocialCdnKind(sourceUrl) != null;
}

/**
 * Social CDNs and session-bound URLs must not use parallel multi-range
 * until range + session behavior is proven safe for that host.
 */
export function shouldUseMultiRangeForSource(
  sourceUrl: string,
  requestContext?: MediaRequestContext | null,
  platformOs = 'android',
): boolean {
  if (platformOs !== 'android') {
    return false;
  }
  if (isSocialCdnUrl(sourceUrl)) {
    return false;
  }
  if (requestContext?.cookiesRequired || requestContext?.hasCookies) {
    return false;
  }
  if (requestContext?.referer?.trim()) {
    return false;
  }
  return true;
}

/**
 * Use expo/fetch streaming with session headers + HTTP guards instead of
 * native DownloadTask when CDN auth context is required.
 */
export function shouldUseAuthenticatedFetchTransfer(
  sourceUrl: string,
  requestContext?: MediaRequestContext | null,
  platformOs = 'android',
): boolean {
  if (platformOs !== 'android') {
    return false;
  }
  if (isSocialCdnUrl(sourceUrl)) {
    return true;
  }
  const headers = buildDownloadHeaders(requestContext);
  return Boolean(
    headers.Referer || headers.Cookie || headers['User-Agent'] || headers.Origin,
  );
}

/**
 * Fail fast when cookies are required but the WebView session has none.
 * Phase 6C: also detects missing ephemeral execution context after process death.
 */
export function assertSessionContextReady(
  sourceUrl: string,
  requestContext?: MediaRequestContext | null,
  downloadId?: string | null,
): void {
  if (downloadId) {
    assertSessionBoundExecutionContext(downloadId, requestContext);
  }
  // Session-bound jobs resolve cookies per-target — hasCookies may be false on stripped meta.
  const metaNeedsLiveCookie =
    requestContext?.authMode === 'SESSION_COOKIE' ||
    requestContext?.authMode === 'SESSION_PLUS_REFERER';
  if (
    requestContext?.cookiesRequired &&
    !requestContext.hasCookies &&
    !metaNeedsLiveCookie &&
    !downloadId
  ) {
    throw new DownloadEngineError(
      'AUTH_ERROR',
      'Open and play the video once to refresh the download.',
    );
  }
  if (isSocialCdnUrl(sourceUrl)) {
    const headers = buildDownloadHeaders(requestContext);
    if (
      !headers.Referer &&
      !headers['User-Agent'] &&
      !requestContext?.referer &&
      !requestContext?.userAgent
    ) {
      throw new DownloadEngineError(
        'AUTH_ERROR',
        'The source rejected the download request.',
      );
    }
  }
}

export function describeSocialCdnHost(sourceUrl: string): string | null {
  return hostOf(sourceUrl);
}

export { PLATFORM_CDN_HOSTS };
