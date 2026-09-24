/**
 * Phase 6B — minimum ephemeral session request context builders.
 *
 * Cookie rule: ONLY CookieManager.getCookie(mediaUrl) — never copy page-host
 * cookies onto unrelated media hosts.
 *
 * Desktop UA: dependency-neutral snapshot accessor — never imports the browser
 * store barrel (breaks require cycles through social-source).
 */

import { getVidoraWeb, isVidoraWebAvailable } from '@modules/vidorax-web';

import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import { readDesktopModeForRequestContext } from '@/browser/session/desktop-mode-snapshot';
import type {
  MediaAuthMode,
  MediaRequestContext,
  MediaRequestContextInput,
} from '@/downloads/types/request-context';
import { isSafeMediaUrl } from '../utils';
import {
  getSessionCookiesForUrl,
  hasSessionCookiesForUrl,
} from '../adapters/cookie-bridge.adapter';
import { normalizePlatformPageUrl } from '../platform';
import { filterSessionMediaHeaders } from './request-header-policy';
import type { SessionMediaScope } from './types';
import { logSessionMedia } from './session-media-diagnostics';

export type BuildSessionAwareContextInput = MediaRequestContextInput & {
  authMode?: MediaAuthMode;
  /** When true, attach Cookie only for mediaUrl via CookieManager. */
  attachCookies?: boolean;
  includeReferer?: boolean;
  includeOrigin?: boolean;
  scope?: Partial<SessionMediaScope> | null;
  /** Force desktop UA from owning tab when known. */
  tabDesktopMode?: boolean | null;
};

let stockWebViewUserAgent: string | null | undefined;

/**
 * The User-Agent a mobile-mode tab really sends: BrowserWebView passes no `userAgent`, so it is the system WebView's
 * own. A media URL bound to the UA that loaded the page must be fetched with that same string, not a lookalike.
 */
function readStockWebViewUserAgent(): string | null {
  if (stockWebViewUserAgent !== undefined) {
    return stockWebViewUserAgent;
  }
  try {
    const ua = isVidoraWebAvailable() ? getVidoraWeb().getDefaultUserAgent() : null;
    stockWebViewUserAgent = typeof ua === 'string' && ua.trim() ? ua.trim() : null;
  } catch {
    stockWebViewUserAgent = null;
  }
  return stockWebViewUserAgent;
}

function resolveUserAgent(input: BuildSessionAwareContextInput): string {
  if (input.userAgent?.trim()) {
    return input.userAgent.trim().slice(0, 512);
  }
  const desktop =
    input.tabDesktopMode != null
      ? Boolean(input.tabDesktopMode)
      : readDesktopModeForRequestContext(input.scope?.tabId ?? null);
  // Desktop mode hands the WebView this exact desktop string, so it is already the tab's real UA.
  const stock = desktop ? null : readStockWebViewUserAgent();
  return (stock ?? buildBrowserUserAgent({ desktop })).slice(0, 512);
}

function resolvePageUrls(input: BuildSessionAwareContextInput): {
  pageUrlRaw: string | null;
  canonicalPage: string | null;
} {
  const pageUrlRaw = input.pageUrl?.trim() || null;
  const canonicalPage =
    (pageUrlRaw ? normalizePlatformPageUrl(pageUrlRaw) : null) ?? pageUrlRaw;
  return { pageUrlRaw, canonicalPage };
}

function pageOrigin(pageUrl: string | null): string | null {
  if (!pageUrl || !isSafeMediaUrl(pageUrl)) {
    return null;
  }
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

/**
 * PUBLIC context — Referer/UA/Accept only. Never attaches Cookie or Authorization.
 */
export async function buildPublicMediaRequestContext(
  input: BuildSessionAwareContextInput,
): Promise<MediaRequestContext> {
  return buildSessionAwareMediaRequestContext({
    ...input,
    authMode: 'PUBLIC',
    attachCookies: false,
    includeReferer: input.includeReferer !== false,
    includeOrigin: false,
  });
}

/**
 * SESSION_COOKIE / SESSION_PLUS_REFERER — Cookie from mediaUrl CookieManager only.
 */
export async function buildSessionCookieMediaRequestContext(
  input: BuildSessionAwareContextInput,
): Promise<MediaRequestContext> {
  return buildSessionAwareMediaRequestContext({
    ...input,
    authMode: undefined,
    attachCookies: true,
    includeReferer: input.includeReferer !== false,
    includeOrigin: Boolean(input.includeOrigin),
  });
}

/**
 * Core builder. Does NOT invent Authorization. Does NOT copy page cookies.
 */
export async function buildSessionAwareMediaRequestContext(
  input: BuildSessionAwareContextInput,
): Promise<MediaRequestContext> {
  const { pageUrlRaw, canonicalPage } = resolvePageUrls(input);
  const mediaUrl = input.mediaUrl.trim();
  const userAgent = resolveUserAgent(input);
  const includeReferer = input.includeReferer !== false;
  const referer =
    includeReferer
      ? input.referer?.trim() ||
        (canonicalPage && isSafeMediaUrl(canonicalPage) ? canonicalPage : null)
      : null;

  const headers: Record<string, string> = {
    Accept: '*/*',
  };
  if (referer && isSafeMediaUrl(referer)) {
    headers.Referer = referer;
  }
  if (userAgent) {
    headers['User-Agent'] = userAgent;
  }
  if (input.includeOrigin) {
    const origin = pageOrigin(canonicalPage);
    if (origin) {
      headers.Origin = origin;
    }
  }

  const forcePublic = input.authMode === 'PUBLIC' || input.attachCookies === false;
  let hasCookies = false;
  let authMode: MediaAuthMode = input.authMode ?? 'PUBLIC';

  if (!forcePublic && isSafeMediaUrl(mediaUrl)) {
    // CRITICAL: target-URL scoped only — never page-host cookie copy.
    const cookieHeader = await getSessionCookiesForUrl(mediaUrl);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
      hasCookies = true;
      authMode =
        referer != null ? 'SESSION_PLUS_REFERER' : 'SESSION_COOKIE';
      logSessionMedia('cookie_present', {
        cookiePresent: true,
        authMode,
        tabId: input.scope?.tabId ?? null,
        pageGeneration: input.scope?.pageGeneration ?? null,
      });
    } else {
      const present = await hasSessionCookiesForUrl(mediaUrl);
      logSessionMedia('session_context_unavailable', {
        cookiePresent: present,
        authMode: 'AUTH_CONTEXT_UNAVAILABLE',
        tabId: input.scope?.tabId ?? null,
      });
      if (input.attachCookies === true || input.requiresCookies) {
        authMode = 'AUTH_CONTEXT_UNAVAILABLE';
      }
    }
  } else {
    authMode = 'PUBLIC';
    logSessionMedia('public_verify_attempt', {
      cookiePresent: false,
      authMode: 'PUBLIC',
      tabId: input.scope?.tabId ?? null,
    });
  }

  // Never allow Authorization through this builder.
  const safeHeaders = filterSessionMediaHeaders(headers, {
    allowAuthorization: false,
  });

  return {
    pageUrl: canonicalPage,
    originalPageUrl: input.originalPageUrl ?? pageUrlRaw,
    redirectChain: input.redirectChain,
    referer,
    userAgent,
    cookiesRequired: Boolean(input.requiresCookies) && authMode !== 'PUBLIC',
    hasCookies,
    headers: safeHeaders,
    capturedAt: Date.now(),
    authMode,
    tabId: input.scope?.tabId ?? null,
    navigationEpoch: input.scope?.navigationEpoch ?? null,
    pageGeneration: input.scope?.pageGeneration ?? null,
    mediaIdentity: input.scope?.mediaIdentity ?? null,
  };
}

export {
  evidenceImpliesSessionBound,
  shouldAttemptPublicFirst,
} from './session-bound-evidence';
