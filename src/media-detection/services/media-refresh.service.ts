import { describePlatformPage } from '../platform';
import { getMsePlaybackContext } from '../engine/mse-playback-context';
import { useMediaDetectionStore } from '../stores';
import { isSameDocumentUrl } from '../utils';
import { resolvePageUrl } from './page-url.resolver';
import { verifyMediaCandidate } from './candidate-verifier.service';
import { buildMediaRequestContext } from './request-context.service';
import { logMediaDiagnostic } from './media-diagnostics.service';
import { isLikelyExpiredMediaUrl } from './expiring-url.service';
import {
  filterCorrelatedCandidates,
  pickBestCorrelatedMedia,
} from './media-correlation.service';
import {
  resolveSocialPlatform,
  selectCurrentMediaForActiveSocialTab,
  socialPageContextStore,
} from '../social';
import { browserMediaActionService } from '@/browser/media-actions/browser-media-action.service';

export type MediaRefreshResult = {
  ok: boolean;
  mediaUrl: string | null;
  pageUrl: string | null;
  reason: string | null;
};

/**
 * Re-resolve page and locate a fresh verified media candidate after expiry/auth failure.
 * Single controlled attempt — no infinite loops.
 */
export async function refreshMediaFromPage(input: {
  pageUrl: string;
  previousMediaUrl: string;
  requiresCookies?: boolean;
  signal?: AbortSignal;
}): Promise<MediaRefreshResult> {
  logMediaDiagnostic('re_resolve', {
    pageUrl: input.pageUrl,
    previousHostname: safeHostname(input.previousMediaUrl),
  });

  const platform = describePlatformPage(input.pageUrl);
  const resolved = await resolvePageUrl(input.pageUrl, { signal: input.signal });
  const canonical = resolved.ok ? resolved.resolvedPageUrl : input.pageUrl;

  const requestContext = await buildMediaRequestContext({
    mediaUrl: input.previousMediaUrl,
    pageUrl: canonical,
    originalPageUrl: input.pageUrl,
    redirectChain: resolved.redirectChain,
    requiresCookies: input.requiresCookies,
  });

  const freshUrl = await pickFreshVerifiedCandidate({
    pageUrl: canonical,
    excludeUrl: input.previousMediaUrl,
    requestContext,
    signal: input.signal,
  });
  if (freshUrl) {
    logMediaDiagnostic('candidate_verified', {
      url: freshUrl,
      platform: platform.kind,
      hasReferer: Boolean(requestContext.referer),
      hasCookies: requestContext.hasCookies,
      isSignedUrl: true,
    });
    return {
      ok: true,
      mediaUrl: freshUrl,
      pageUrl: canonical,
      reason: null,
    };
  }

  const verification = await verifyMediaCandidate(input.previousMediaUrl, {
    requestContext,
    signal: input.signal,
  });

  if (!verification.ok) {
    logMediaDiagnostic('expired_url', {
      pageUrl: canonical,
      platform: platform.kind,
      reason: verification.rejectionReason,
    });
    return {
      ok: false,
      mediaUrl: null,
      pageUrl: canonical,
      reason: verification.rejectionReason,
    };
  }

  if (isLikelyExpiredMediaUrl(verification.finalUrl, Date.now())) {
    return {
      ok: false,
      mediaUrl: null,
      pageUrl: canonical,
      reason: 'still_expired',
    };
  }

  logMediaDiagnostic('candidate_verified', {
    url: verification.finalUrl,
    mimeType: verification.mimeType,
    platform: platform.kind,
    hasReferer: Boolean(requestContext.referer),
    hasCookies: requestContext.hasCookies,
    isSignedUrl: true,
  });

  return {
    ok: true,
    mediaUrl: verification.finalUrl,
    pageUrl: canonical,
    reason: null,
  };
}

async function pickFreshVerifiedCandidate(input: {
  pageUrl: string;
  excludeUrl: string;
  requestContext: Awaited<ReturnType<typeof buildMediaRequestContext>>;
  signal?: AbortSignal;
}): Promise<string | null> {
  const store = useMediaDetectionStore.getState();
  const mse = getMsePlaybackContext(input.pageUrl);
  const candidates = store.detectedMedia.filter(
    (media) =>
      media.pageUrl &&
      isSameDocumentUrl(media.pageUrl, input.pageUrl) &&
      !media.url.startsWith('blob:') &&
      media.url !== input.excludeUrl,
  );

  if (!candidates.length) {
    return null;
  }

  // Phase 4B: prefer Phase 4A ownership when on Instagram/TikTok.
  let best = null as (typeof candidates)[number] | null;
  const platform = resolveSocialPlatform(input.pageUrl);
  const tabId =
    socialPageContextStore.getActiveTabId() ??
    browserMediaActionService.getActiveTabId();

  if (platform && tabId) {
    const social = selectCurrentMediaForActiveSocialTab({
      candidates,
      tabId,
      navigationEpoch: store.navigationEpoch,
      pageUrl: input.pageUrl,
      msePlaybackActive: mse.msePlaybackActive,
      msePlaybackAgeMs: mse.msePlaybackAgeMs,
    });
    if (social.usedSocialCorrelation && social.media) {
      best = social.media;
    }
  }

  if (!best) {
    const correlated = filterCorrelatedCandidates(candidates, {
      pageUrl: input.pageUrl,
      ...mse,
    });
    best = pickBestCorrelatedMedia(correlated, {
      pageUrl: input.pageUrl,
      ...mse,
    });
  }

  if (!best) {
    return null;
  }

  const verification = await verifyMediaCandidate(best.url, {
    requestContext: input.requestContext,
    signal: input.signal,
  });
  if (!verification.ok) {
    return null;
  }
  if (isLikelyExpiredMediaUrl(verification.finalUrl, Date.now())) {
    return null;
  }
  return verification.finalUrl;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
