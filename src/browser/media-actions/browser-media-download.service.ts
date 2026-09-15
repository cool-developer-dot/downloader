import type { MediaAnalysisResult } from '@/api/types';
import {
  findQualityOptionById,
  normalizeAnalysisToSelection,
  selectDefaultQualityOption,
  toCreateDownloadInput,
} from '@/downloads/quality';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import type { SocialSourceRefreshIdentity } from '@/downloads/engine/social-source-refresh.provider';
import { resolveFreshSocialSourceForDownload } from '@/downloads/engine/social-source-refresh.provider';
import { ensurePhase1SocialSourceRefreshRegistered } from '@/media-detection/social-source/register-phase1-source-refresh';
import { runPreDownloadGate } from '@/media-detection/services/pre-download-gate.service';
import { refreshMediaFromPage } from '@/media-detection/services/media-refresh.service';
import { buildMediaRequestContext } from '@/media-detection/services/request-context.service';
import { pendingMediaResolutionService } from '@/media-detection/services/pending-media-resolution.service';
import { useDownloadsStore } from '@/store/downloads';
import { logSocialSource } from '@/media-detection/social-source/social-source-diagnostics';
import { normalizeMediaUrl } from '@/media-detection/utils';
import { sameResourceFamily, stableResourcePath } from '@/media-detection/social-source/resource-identity';

export type BrowserDownloadResult =
  | { ok: true; downloadId: string }
  | { ok: false; message: string; refreshable?: boolean };

/**
 * Share the verified-resource identity policy: retain content/quality selectors
 * and case-sensitive paths while allowing known credential rotation.
 */
function mediaIdentityKey(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeMediaUrl(trimmed) ?? trimmed;
  return stableResourcePath(normalized);
}

/** Media component of a `platform|pageKey|mediaKey` fingerprint. */
function fingerprintMediaKey(fingerprint: string): string | null {
  const separator = fingerprint.lastIndexOf('|');
  const key = (separator >= 0 ? fingerprint.slice(separator + 1) : fingerprint).trim();
  return key || null;
}

export function findDownloadForBrowserMedia(input: {
  fingerprint: string;
  mediaUrl: string | null;
}): { id: string; status: string; progress: number } | null {
  const targetKey =
    mediaIdentityKey(input.mediaUrl) ?? fingerprintMediaKey(input.fingerprint);
  if (!targetKey) {
    return null;
  }

  const { itemsById } = useDownloadsStore.getState();
  for (const item of Object.values(itemsById)) {
    if (mediaIdentityKey(item.sourceUrl) === targetKey) {
      return { id: item.id, status: item.status, progress: item.progress };
    }
  }

  return null;
}

export async function enqueueBrowserMediaDownload(input: {
  analysis: MediaAnalysisResult;
  requestContext: MediaRequestContext;
  selectedOptionId?: string | null;
  fingerprint: string;
  socialSourceIdentity?: SocialSourceRefreshIdentity | null;
}): Promise<BrowserDownloadResult> {
  const selection = normalizeAnalysisToSelection(input.analysis);
  const option =
    input.selectedOptionId != null
      ? findQualityOptionById(selection.options, input.selectedOptionId)
      : selectDefaultQualityOption(selection.options);

  if (!option?.downloadable) {
    return { ok: false, message: 'This quality is not available for download.' };
  }

  const payload = toCreateDownloadInput(selection, option);
  if (!payload) {
    return { ok: false, message: 'Could not prepare download.' };
  }

  // Dedupe the exact chosen variant, never the analysis' preferred source.
  const existing = findDownloadForBrowserMedia({
    fingerprint: input.fingerprint,
    mediaUrl: payload.sourceUrl,
  });
  if (existing && !['FAILED', 'CANCELLED'].includes(existing.status)) {
    return { ok: true, downloadId: existing.id };
  }

  let ctx = input.requestContext;
  let socialIdentity = input.socialSourceIdentity ?? null;
  const isHlsOption =
    option.streamType === 'HLS' ||
    option.isHls === true ||
    option.container === 'hls';
  const gateTransport = isHlsOption
    ? ('HLS' as const)
    : option.streamType === 'AUDIO'
      ? ('AUDIO' as const)
      : option.streamType === 'PROGRESSIVE'
        ? ('PROGRESSIVE' as const)
        : null;

  const gate = await runPreDownloadGate({
    sourceUrl: payload.sourceUrl,
    requestContext: ctx,
    verifiedAtMs: ctx.capturedAt,
    transport: gateTransport,
  });

  if (!gate.ok) {
    if (gate.refreshable) {
      logSocialSource('refresh_started', {
        contentIdentity: socialIdentity?.contentIdentity,
        reason: 'PRE_HANDOFF',
        tabId: socialIdentity?.tabId,
      });

      let refreshed = false;
      if (socialIdentity?.contentIdentity && socialIdentity.variantIdentity) {
        ensurePhase1SocialSourceRefreshRegistered();
        const fresh = await resolveFreshSocialSourceForDownload({
          downloadId: 'pre-handoff',
          downloadGeneration: 0,
          priorSourceUrl: payload.sourceUrl,
          priorRequestContext: ctx,
          identity: {
            ...socialIdentity,
            pageUrl: socialIdentity.pageUrl ?? ctx.pageUrl,
          },
          reason: 'PRE_HANDOFF',
        });
        if (fresh.type === 'FRESH') {
          const retryGate = await runPreDownloadGate({
            sourceUrl: fresh.sourceUrl,
            requestContext: fresh.requestContext,
            transport: gateTransport,
          });
          if (retryGate.ok) {
            ctx = retryGate.requestContext;
            payload.sourceUrl = retryGate.finalUrl;
            if (
              retryGate.transport !== 'HLS' &&
              retryGate.contentLength != null &&
              retryGate.contentLength > 0
            ) {
              payload.fileSize = retryGate.contentLength;
            }
            socialIdentity = {
              ...socialIdentity,
              contentIdentity:
                fresh.contentIdentity ?? socialIdentity.contentIdentity,
              variantIdentity:
                fresh.variantIdentity ?? socialIdentity.variantIdentity,
              pageUrl: fresh.requestContext.pageUrl ?? socialIdentity.pageUrl,
            };
            refreshed = true;
            logSocialSource('refresh_succeeded', {
              contentIdentity: socialIdentity.contentIdentity,
              reason: 'PRE_HANDOFF',
            });
          }
        }
      }

      if (!refreshed && pendingMediaResolutionService.get()?.canonicalUrl) {
        const session = pendingMediaResolutionService.get();
        if (session?.canonicalUrl) {
          const refresh = await refreshMediaFromPage({
            pageUrl: session.canonicalUrl,
            previousMediaUrl: payload.sourceUrl,
            requiresCookies: ctx.cookiesRequired,
          });
          if (refresh.ok && refresh.mediaUrl && sameResourceFamily(payload.sourceUrl, refresh.mediaUrl)) {
            const refreshedCtx = await buildMediaRequestContext({
              mediaUrl: refresh.mediaUrl,
              pageUrl: refresh.pageUrl ?? session.canonicalUrl,
              originalPageUrl: session.originalUrl,
              requiresCookies: ctx.cookiesRequired,
            });
            const retryGate = await runPreDownloadGate({
              sourceUrl: refresh.mediaUrl,
              requestContext: refreshedCtx,
              transport: gateTransport,
            });
            if (retryGate.ok) {
              ctx = retryGate.requestContext;
              payload.sourceUrl = retryGate.finalUrl;
              if (
                retryGate.transport !== 'HLS' &&
                retryGate.contentLength != null &&
                retryGate.contentLength > 0
              ) {
                payload.fileSize = retryGate.contentLength;
              }
              refreshed = true;
            } else {
              return { ok: false, message: retryGate.userMessage, refreshable: true };
            }
          } else {
            return { ok: false, message: gate.userMessage, refreshable: true };
          }
        }
      }

      if (!refreshed) {
        return { ok: false, message: gate.userMessage, refreshable: true };
      }
    } else {
      return { ok: false, message: gate.userMessage, refreshable: gate.refreshable };
    }
  } else {
    ctx = gate.requestContext;
    payload.sourceUrl = gate.finalUrl;
    if (
      gate.transport !== 'HLS' &&
      gate.contentLength != null &&
      gate.contentLength > 0
    ) {
      payload.fileSize = gate.contentLength;
    }
  }

  const created = await useDownloadsStore.getState().create({
    ...payload,
    requestContext: ctx,
    socialSourceIdentity: socialIdentity,
  });

  if (!created) {
    const storeError = useDownloadsStore.getState().error;
    return {
      ok: false,
      message: storeError?.trim() || 'Could not start download.',
    };
  }

  return { ok: true, downloadId: created.id };
}
