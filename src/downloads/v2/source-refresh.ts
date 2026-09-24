/**
 * Phase 11C — the verified source has to still be good at the moment it is enqueued.
 *
 * A source is verified when the CTA appears; the user taps it whenever they like. Signed CDN links
 * (TikTok, Instagram, and every other expiring URL) can die in that gap, and the engine then gets a URL
 * that answers 403. This confirms the chosen variant is still current right before the handoff, and —
 * when it is not — re-resolves it from the page the user is still on before giving up.
 *
 * Nothing here re-opens selection: the media is already chosen. It only refreshes *that* media's URL,
 * re-verifies it, and hands the exact fresh source forward, carrying the User-Agent, Referer and cookie
 * requirement through unchanged.
 */
import type { MediaRequestContext } from '@/downloads/types/request-context';
import type { PreDownloadGateResult } from '@/media-detection/services/pre-download-gate.service';
import { assessExpiringMediaUrl } from '@/media-detection/services/expiring-url.service';

/** Shown when the link is gone and the page can no longer supply a new one. */
export const SOURCE_EXPIRED_MESSAGE =
  'Open the video page again to refresh the download link.';

/**
 * A source verified this recently, with no expiry evidence in its URL, is taken as still current: the
 * tap follows the offer by a moment, and re-probing every download would undo the Phase 10 work.
 */
export const SOURCE_TRUSTED_WINDOW_MS = 20_000;

export type FreshSourceCandidate = {
  url: string;
  requestContext: MediaRequestContext | null;
};

/** Re-resolves the same logical media from what the live page/session has observed most recently. */
export type LiveSourceLookup = (input: {
  pageUrl: string | null;
  previousUrl: string;
}) => FreshSourceCandidate | null;

export type SourceGate = (input: {
  sourceUrl: string;
  requestContext: MediaRequestContext;
  verifiedAtMs?: number;
}) => Promise<PreDownloadGateResult>;

export type ResolveFreshSourceDeps = {
  lookupLiveSource: LiveSourceLookup;
  gate: SourceGate;
  now?: () => number;
};

export type ResolveFreshSourceInput = {
  sourceUrl: string;
  pageUrl: string | null;
  requestContext: MediaRequestContext | null;
  /** When this variant was verified. Defaults to the request context's capture time. */
  verifiedAtMs?: number | null;
};

export type ResolveFreshSourceResult =
  | {
      ok: true;
      /** Exactly what must be enqueued: redirect-resolved and re-verified when it had to be. */
      url: string;
      requestContext: MediaRequestContext | null;
      contentLength: number | null;
      /** True when the URL changed (a rotated signature, or a resolved redirect). */
      refreshed: boolean;
      /** True when the source was confirmed over the network rather than trusted as recent. */
      reverified: boolean;
    }
  | {
      ok: false;
      reason: 'SOURCE_EXPIRED' | 'SOURCE_UNVERIFIED';
      message: string;
    };

/** Gate failures that mean "this link is dead", as opposed to "this is not media". */
const EXPIRY_REASONS = new Set([
  'expired_url',
  'session_missing',
  'headers_missing',
  'auth_response',
  'AUTH_RESPONSE',
  'EXPIRED_SOURCE',
]);

function isExpiryShaped(reason: string | null | undefined): boolean {
  if (!reason) {
    return false;
  }
  return EXPIRY_REASONS.has(reason) || /expired|auth|session|403|404/i.test(reason);
}

function sameUrl(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Confirms the chosen source is still current, refreshing it from the live page when it is not.
 *
 * Order matters: the cheapest evidence first (a newer URL the detector already observed for this same
 * media costs nothing), then a network re-verification only when the URL looks expiring or the offer is
 * no longer fresh, then one refresh-and-retry, then an honest refusal.
 */
export async function resolveFreshSourceForEnqueue(
  input: ResolveFreshSourceInput,
  deps: ResolveFreshSourceDeps,
): Promise<ResolveFreshSourceResult> {
  const now = deps.now ?? Date.now;
  const original = input.sourceUrl.trim();
  if (!original) {
    return { ok: false, reason: 'SOURCE_UNVERIFIED', message: SOURCE_EXPIRED_MESSAGE };
  }

  // 1. The session's own freshest URL for this media. A rotated signature is already in the store.
  const live = deps.lookupLiveSource({ pageUrl: input.pageUrl, previousUrl: original });
  let url = live?.url?.trim() || original;
  let requestContext = live?.requestContext ?? input.requestContext;
  let refreshed = !sameUrl(url, original);

  const verifiedAt = input.verifiedAtMs ?? requestContext?.capturedAt ?? now();
  const expiring = assessExpiringMediaUrl(url, now()).likelyExpiring;
  const stale = now() - verifiedAt > SOURCE_TRUSTED_WINDOW_MS;

  // 2. A plain, just-verified source is handed over as it is — no second probe per download.
  if (!expiring && !stale) {
    return { ok: true, url, requestContext, contentLength: null, refreshed, reverified: false };
  }

  if (!requestContext) {
    // Nothing to authenticate or attribute the request with; the engine's own probe is the next check.
    return { ok: true, url, requestContext, contentLength: null, refreshed, reverified: false };
  }

  // 3. Confirm over the network, following redirects, with the session headers preserved.
  let result = await deps.gate({ sourceUrl: url, requestContext, verifiedAtMs: verifiedAt });

  // 4. One refresh-and-retry: the page may have produced a newer link while we were probing.
  if (!result.ok && result.refreshable) {
    const retryCandidate = deps.lookupLiveSource({ pageUrl: input.pageUrl, previousUrl: url });
    if (retryCandidate && !sameUrl(retryCandidate.url, url)) {
      url = retryCandidate.url.trim();
      requestContext = retryCandidate.requestContext ?? requestContext;
      refreshed = true;
      result = await deps.gate({ sourceUrl: url, requestContext, verifiedAtMs: now() });
    }
  }

  if (!result.ok) {
    const expired = isExpiryShaped(result.reason) || assessExpiringMediaUrl(url, now()).isExpired;
    return expired
      ? { ok: false, reason: 'SOURCE_EXPIRED', message: SOURCE_EXPIRED_MESSAGE }
      : { ok: false, reason: 'SOURCE_UNVERIFIED', message: result.userMessage };
  }

  return {
    ok: true,
    url: result.finalUrl,
    requestContext: result.requestContext,
    contentLength: result.contentLength,
    refreshed: refreshed || !sameUrl(result.finalUrl, original),
    reverified: true,
  };
}
