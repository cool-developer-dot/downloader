import type { MediaAnalysisResult } from '@/api/types';
import {
  findQualityOptionById,
  normalizeAnalysisToSelection,
  selectDefaultQualityOption,
  toCreateDownloadInput,
} from '@/downloads/quality';
import { resolveDownloadTitle } from '@/downloads/quality/download-metadata';
import type { AnalyzedMediaSelection, DownloadQualityOption } from '@/downloads/quality/types';
import type { MediaRequestContext } from '@/downloads/types/request-context';
import { getV2Engine, handOffVerifiedVariant } from '@/downloads/v2';
import { resolveFreshSourceForEnqueue } from '@/downloads/v2/source-refresh';
import { runPreDownloadGate } from '@/media-detection/services/pre-download-gate.service';
import { stableResourcePath } from '@/media-detection/social-source/resource-identity';
import { useMediaDetectionStore } from '@/media-detection/stores';
import { normalizeMediaUrl } from '@/media-detection/utils';
import { useBrowserStore } from '@/browser/stores/browserStore';
import { useDownloadsStore } from '@/store/downloads';

import { pickDownloadTitle } from './download-title';
import { lookupLiveMediaTitle } from './live-media-title';

export type BrowserDownloadResult =
  /** `deduped`: this exact verified variant was already accepted, so nothing new was enqueued. */
  | { ok: true; downloadId: string; deduped: boolean }
  | { ok: false; message: string; reason?: string };

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

/** The same verified variant tapped twice is one download, whatever its signed query looks like now. */
function variantKeyFor(
  option: DownloadQualityOption,
  contentIdentity: string | null | undefined,
  pageUrl: string | null | undefined,
): string {
  const resource = mediaIdentityKey(option.sourceUrl) ?? option.sourceUrl;
  return `${contentIdentity ?? pageUrl ?? ''}|${resource}|${option.id}`;
}

export type BrowserVariantHandoffInput = {
  selection: AnalyzedMediaSelection;
  /** Exactly what the user chose (or the single verified variant) — never re-resolved or substituted. */
  option: DownloadQualityOption;
  requestContext: MediaRequestContext | null;
  pageUrl: string | null;
  contentIdentity: string | null;
  /** Checked again immediately before enqueue: a tab/content/generation change must abandon the handoff. */
  isOfferCurrent: () => boolean;
};

/**
 * The freshest URL the live page has produced for this same media. A signed CDN link is re-observed with a
 * rotated signature while the page plays, and `dedupeUpsert` keeps the newest one on the same record — so the
 * current session already holds the refreshed link, with no extra request and no site-specific extraction.
 */
export function lookupLiveBrowserSource(input: {
  pageUrl: string | null;
  previousUrl: string;
}): { url: string; requestContext: MediaRequestContext | null } | null {
  const targetKey = mediaIdentityKey(input.previousUrl);
  if (!targetKey) {
    return null;
  }
  const { detectedMedia } = useMediaDetectionStore.getState();
  for (const media of detectedMedia) {
    const candidate = media.finalUrl || media.url;
    if (!candidate || candidate.toLowerCase().startsWith('blob:')) {
      continue;
    }
    if (mediaIdentityKey(candidate) !== targetKey) {
      continue;
    }
    return candidate.trim() === input.previousUrl.trim()
      ? null
      : { url: candidate, requestContext: null };
  }
  return null;
}

/**
 * Hands the chosen verified variant to the v2 native DownloadEngine. The engine probes, transfers, verifies,
 * finalizes and inserts the library item; JavaScript never transfers bytes and never falls back to v1.
 *
 * The source is confirmed still current first (Phase 11C): the exact fresh, redirect-resolved URL is what the
 * engine receives, and a link that died between the offer and the tap is refused with a useful message instead
 * of being handed over to fail.
 */
export async function enqueueVerifiedBrowserVariant(
  input: BrowserVariantHandoffInput,
): Promise<BrowserDownloadResult> {
  const payload = toCreateDownloadInput(input.selection, input.option);
  if (!payload) {
    return { ok: false, message: 'Could not prepare download.' };
  }
  const pageUrl = input.pageUrl ?? input.requestContext?.pageUrl ?? null;
  const isHls = input.option.isHls || input.option.streamType === 'HLS' || input.option.container === 'hls';
  const isDash = input.option.streamType === 'DASH';

  const fresh = await resolveFreshSourceForEnqueue(
    {
      sourceUrl: input.option.sourceUrl,
      pageUrl,
      requestContext: input.requestContext,
    },
    {
      lookupLiveSource: lookupLiveBrowserSource,
      // A stream is classified by the native HLS/DASH planner right before it is enqueued (playlists or manifest,
      // keys/ContentProtection, live, separate audio) — one classifier, not a second JS one here.
      gate: isHls || isDash
        ? async (gateInput) => ({
            ok: true,
            finalUrl: gateInput.sourceUrl,
            mimeType: isHls ? 'application/vnd.apple.mpegurl' : 'application/dash+xml',
            contentLength: null,
            requestContext: gateInput.requestContext,
            transport: isHls ? 'HLS' : 'DASH',
          })
        : (gateInput) =>
            runPreDownloadGate({
              sourceUrl: gateInput.sourceUrl,
              requestContext: gateInput.requestContext,
              verifiedAtMs: gateInput.verifiedAtMs,
              transport: 'PROGRESSIVE',
            }),
    },
  );
  if (!fresh.ok) {
    return { ok: false, message: fresh.message, reason: fresh.reason };
  }

  const option =
    fresh.url === input.option.sourceUrl
      ? input.option
      : { ...input.option, sourceUrl: fresh.url };

  // Detection may have built the offer before the page's title arrived; the tab showing the page knows it.
  const liveTitle = lookupLiveMediaTitle({ pageUrl, sourceUrl: input.option.sourceUrl });
  const title = pickDownloadTitle({
    resolved: liveTitle ? resolveDownloadTitle({ title: liveTitle, pageTitle: payload.title }) : payload.title,
    pageUrl,
    tabs: useBrowserStore.getState().tabs,
  });

  const result = await handOffVerifiedVariant(
    {
      option,
      title,
      pageUrl,
      thumbnailUrl: payload.thumbnailUrl || input.selection.thumbnailUrl || null,
      requestContext: fresh.requestContext ?? input.requestContext,
      // Keyed on the stable resource, so a refreshed signature is still the same one download.
      variantKey: variantKeyFor(input.option, input.contentIdentity, pageUrl),
    },
    {
      engine: getV2Engine(),
      applyEntries: (entries) => useDownloadsStore.getState().applyEngineEntries(entries),
      statusOf: (id) => useDownloadsStore.getState().engineRowsById[id]?.status ?? null,
      isOfferCurrent: input.isOfferCurrent,
    },
  );
  return result.ok
    ? { ok: true, downloadId: result.downloadId, deduped: result.deduped }
    : { ok: false, message: result.message, reason: result.reason };
}

export async function enqueueBrowserMediaDownload(input: {
  analysis: MediaAnalysisResult;
  requestContext: MediaRequestContext;
  selectedOptionId?: string | null;
  fingerprint: string;
  pageUrl?: string | null;
  contentIdentity?: string | null;
  isOfferCurrent?: () => boolean;
}): Promise<BrowserDownloadResult> {
  const selection = normalizeAnalysisToSelection(input.analysis);
  const option =
    input.selectedOptionId != null
      ? findQualityOptionById(selection.options, input.selectedOptionId)
      : selectDefaultQualityOption(selection.options);

  if (!option?.downloadable) {
    return { ok: false, message: 'This quality is not available for download.' };
  }

  return enqueueVerifiedBrowserVariant({
    selection,
    option,
    requestContext: input.requestContext,
    pageUrl: input.pageUrl ?? null,
    contentIdentity: input.contentIdentity ?? null,
    isOfferCurrent: input.isOfferCurrent ?? (() => true),
  });
}
