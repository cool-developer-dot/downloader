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

import { buildBrowserMediaFingerprint } from './media-fingerprint';

export type BrowserDownloadResult =
  | { ok: true; downloadId: string }
  | { ok: false; message: string; refreshable?: boolean };

function findActiveDownloadByFingerprint(fingerprint: string): {
  id: string;
  status: string;
  progress: number;
} | null {
  const { itemsById } = useDownloadsStore.getState();
  for (const item of Object.values(itemsById)) {
    const itemFingerprint = buildBrowserMediaFingerprint({
      pageUrl: item.sourceUrl,
      mediaUrl: item.sourceUrl,
      platform: item.platform,
    });
    if (itemFingerprint === fingerprint) {
      return { id: item.id, status: item.status, progress: item.progress };
    }
    if (item.sourceUrl && fingerprint.includes(item.sourceUrl.toLowerCase())) {
      return { id: item.id, status: item.status, progress: item.progress };
    }
  }
  return null;
}

export function findDownloadForBrowserMedia(input: {
  fingerprint: string;
  mediaUrl: string | null;
}): { id: string; status: string; progress: number } | null {
  const { itemsById } = useDownloadsStore.getState();
  const normalizedMedia = input.mediaUrl?.trim().toLowerCase() ?? '';

  for (const item of Object.values(itemsById)) {
    const source = item.sourceUrl?.trim().toLowerCase() ?? '';
    if (!source) {
      continue;
    }
    if (normalizedMedia && (source === normalizedMedia || source.includes(normalizedMedia.slice(0, 48)))) {
      return { id: item.id, status: item.status, progress: item.progress };
    }
  }

  return findActiveDownloadByFingerprint(input.fingerprint);
}

export async function enqueueBrowserMediaDownload(input: {
  analysis: MediaAnalysisResult;
  requestContext: MediaRequestContext;
  selectedOptionId?: string | null;
  fingerprint: string;
  socialSourceIdentity?: SocialSourceRefreshIdentity | null;
}): Promise<BrowserDownloadResult> {
  const existing = findDownloadForBrowserMedia({
    fingerprint: input.fingerprint,
    mediaUrl: input.analysis.finalUrl ?? input.analysis.sourceUrl,
  });

  if (existing) {
    const active = ['QUEUED', 'DOWNLOADING', 'PAUSED'].includes(existing.status);
    if (active || existing.status === 'COMPLETED') {
      return { ok: true, downloadId: existing.id };
    }
  }

  const selection = normalizeAnalysisToSelection(input.analysis);
  const option =
    (input.selectedOptionId
      ? findQualityOptionById(selection.options, input.selectedOptionId)
      : null) ?? selectDefaultQualityOption(selection.options);

  if (!option?.downloadable) {
    return { ok: false, message: 'This quality is not available for download.' };
  }

  const payload = toCreateDownloadInput(selection, option);
  if (!payload) {
    return { ok: false, message: 'Could not prepare download.' };
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
          if (refresh.ok && refresh.mediaUrl) {
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
