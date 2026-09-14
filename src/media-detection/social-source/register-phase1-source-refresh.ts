/**
 * Registers Phase 4B fresh-source resolution as Phase 1's refresh provider.
 * Side-effect module — import once from MediaDetectionHost / app boot.
 */

import {
  registerSocialSourceRefreshProvider,
  type FreshSocialSourceResult,
  type ResolveFreshSocialSourceInput,
} from '@/downloads/engine/social-source-refresh.provider';
import { refreshMediaFromPage } from '../services/media-refresh.service';
import { buildMediaRequestContext } from '../services/request-context.service';
import { getFreshExecutableSocialSource } from './social-source-provider';
import { logSocialSource } from './social-source-diagnostics';
import { preserveExecutableUrl } from './resource-identity';

let registered = false;

async function resolveViaPhase4B(
  input: ResolveFreshSocialSourceInput,
): Promise<FreshSocialSourceResult | null> {
  const identity = input.identity;
  if (
    !identity?.contentIdentity ||
    !identity.variantIdentity ||
    !identity.tabId ||
    identity.navigationEpoch == null ||
    identity.socialContextGeneration == null ||
    !identity.pageUrl
  ) {
    return null;
  }

  const result = await getFreshExecutableSocialSource({
    tabId: identity.tabId,
    navigationEpoch: identity.navigationEpoch,
    socialContextGeneration: identity.socialContextGeneration,
    contentIdentity: identity.contentIdentity,
    variantIdentity: identity.variantIdentity,
    previousUrl: input.priorSourceUrl,
    pageUrl: identity.pageUrl,
    requestContext: input.priorRequestContext,
  });

  if (result.outcome === 'FRESH') {
    logSocialSource('mid_transfer_refresh_succeeded', {
      tabId: identity.tabId,
      contentIdentity: identity.contentIdentity,
      variantId: identity.variantIdentity,
      reason: input.reason,
    });
    return {
      type: 'FRESH',
      sourceUrl: preserveExecutableUrl(result.executableUrl),
      requestContext: result.requestContext,
      contentIdentity: result.contentIdentity,
      variantIdentity: result.variantId,
    };
  }

  if (result.outcome === 'STALE_CONTEXT') {
    logSocialSource('mid_transfer_refresh_unavailable', {
      tabId: identity.tabId,
      contentIdentity: identity.contentIdentity,
      reason: result.reason,
    });
    return { type: 'STALE_CONTEXT', reason: result.reason };
  }

  if (result.outcome === 'UNSUPPORTED') {
    return { type: 'UNSUPPORTED', reason: result.reason };
  }

  return { type: 'NO_SOURCE', reason: result.reason };
}

async function resolveViaPageRefresh(
  input: ResolveFreshSocialSourceInput,
): Promise<FreshSocialSourceResult> {
  const pageUrl =
    input.identity?.pageUrl ??
    input.priorRequestContext?.pageUrl ??
    input.priorRequestContext?.originalPageUrl ??
    null;
  if (!pageUrl) {
    return { type: 'NO_SOURCE', reason: 'NO_PAGE_URL' };
  }

  const refresh = await refreshMediaFromPage({
    pageUrl,
    previousMediaUrl: input.priorSourceUrl,
    requiresCookies: input.priorRequestContext?.cookiesRequired,
  });

  if (!refresh.ok || !refresh.mediaUrl) {
    logSocialSource('mid_transfer_refresh_unavailable', {
      reason: 'NO_FRESH_SOURCE',
      contentIdentity: input.identity?.contentIdentity,
    });
    return { type: 'NO_SOURCE', reason: 'NO_FRESH_SOURCE' };
  }

  // Reject unrelated content when we have a stable content identity and page changed.
  if (
    input.identity?.contentIdentity &&
    refresh.pageUrl &&
    input.identity.pageUrl &&
    refresh.pageUrl !== input.identity.pageUrl
  ) {
    const priorId = input.identity.contentIdentity;
    // Page URL host/path must still match identity platform content when possible.
    if (!refresh.pageUrl.includes(priorId.split(':').pop() ?? '\0')) {
      logSocialSource('stale_source_result_ignored', {
        contentIdentity: priorId,
        reason: 'UNRELATED_REFRESH',
      });
      return { type: 'NO_SOURCE', reason: 'UNRELATED_REFRESH' };
    }
  }

  const requestContext = await buildMediaRequestContext({
    mediaUrl: refresh.mediaUrl,
    pageUrl: refresh.pageUrl ?? pageUrl,
    originalPageUrl: input.priorRequestContext?.originalPageUrl ?? pageUrl,
    requiresCookies: input.priorRequestContext?.cookiesRequired,
  });

  logSocialSource('mid_transfer_refresh_succeeded', {
    contentIdentity: input.identity?.contentIdentity,
    reason: input.reason,
    via: 'page_refresh',
  });

  return {
    type: 'FRESH',
    sourceUrl: preserveExecutableUrl(refresh.mediaUrl),
    requestContext,
    contentIdentity: input.identity?.contentIdentity,
    variantIdentity: input.identity?.variantIdentity,
  };
}

/**
 * Idempotent registration for Phase 1 ↔ Phase 4B refresh bridge.
 */
export function ensurePhase1SocialSourceRefreshRegistered(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerSocialSourceRefreshProvider({
    async resolveFreshSource(input) {
      logSocialSource('mid_transfer_refresh_requested', {
        downloadId: input.downloadId,
        reason: input.reason,
        contentIdentity: input.identity?.contentIdentity,
        variantId: input.identity?.variantIdentity,
      });

      const phase4b = await resolveViaPhase4B(input);
      if (phase4b) {
        if (phase4b.type === 'FRESH' || phase4b.type === 'UNSUPPORTED') {
          return phase4b;
        }
        // STALE_CONTEXT / NO_SOURCE — fall through to page refresh when pageUrl lives.
        if (phase4b.type === 'STALE_CONTEXT' && !input.identity?.pageUrl && !input.priorRequestContext?.pageUrl) {
          return phase4b;
        }
        if (phase4b.type === 'NO_SOURCE' && phase4b.reason === 'NO_FRESH_SOURCE') {
          // Still try page-level refresh once (bounded by Phase 1 refreshAttempted).
        } else if (phase4b.type === 'STALE_CONTEXT') {
          // Tab closed / generation moved — page refresh may still help if pageUrl known.
        }
      }

      return resolveViaPageRefresh(input);
    },
  });
}
