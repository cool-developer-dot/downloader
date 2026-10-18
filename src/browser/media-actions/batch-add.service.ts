/**
 * Batch Add (#292): one link at a time through the existing direct analyzer (the same page fetch, extraction and
 * verification a pasted link gets — YouTube, private hosts, DRM and live are refused there as everywhere), and,
 * when it finds exactly one verified video, through the normal download path at the default quality
 * (`enqueueBrowserMediaDownload` → handoff → the engine's atomic duplicate check). Nothing is published to a tab.
 */

import type { PageFetchRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import { batchOutcomeFor, classifyIntakeLink, type BatchOutcome } from '@/browser/services/link-intake';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { directOfferIdentity } from '@/media-detection/direct-analyzer/direct-offer-policy';
import {
  defaultDirectVerifierDeps,
  verifyDirectCandidates,
  type DirectOffer,
} from '@/media-detection/direct-analyzer/direct-verifier';
import { analyzePastedLink } from '@/media-detection/direct-analyzer/resolve-direct-page';

import { enqueueBrowserMediaDownload } from './browser-media-download.service';

/** The same bounds the browser's direct analysis uses for a pasted link. */
const TAB_FETCH_TIMEOUT_MS = 6_000;
const OTHER_FETCH_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;

export type BatchLinkResult = {
  url: string;
  outcome: BatchOutcome;
  /** The analyzer's status (`SUPPORTED`, `UNRESOLVED`, `PROTECTED`…) or the refusal, for the row's label. */
  detail: string;
  title: string | null;
  downloadId: string | null;
};

export async function addLinkFromBatch(url: string, signal: AbortSignal): Promise<BatchLinkResult> {
  const verdict = classifyIntakeLink(url);
  if (verdict !== 'ok') {
    return { url, outcome: 'refused', detail: verdict.toUpperCase(), title: null, downloadId: null };
  }
  const engine = getV2Engine();
  if (!engine?.fetchPage) {
    return { url, outcome: 'needs-review', detail: 'UNAVAILABLE', title: null, downloadId: null };
  }

  const result = await analyzePastedLink<DirectOffer>({
    url,
    signal,
    ports: {
      fetchPage: async ({ url: pageUrl, mode, commitCookies }) => {
        const request: PageFetchRequest = {
          url: pageUrl,
          // Mobile reads use the WebView's own User-Agent (omitted); the desktop retry asks for the desktop site.
          userAgent: mode === 'desktop' ? buildBrowserUserAgent({ desktop: true }) : undefined,
          useSessionCookies: true,
          commitCookies,
          timeoutMs: mode === 'tab' ? TAB_FETCH_TIMEOUT_MS : OTHER_FETCH_TIMEOUT_MS,
          maxBytes: PAGE_MAX_BYTES,
        };
        return engine.fetchPage!(request);
      },
      verify: ({ candidates, pageUrl, extraction, signal: verifySignal }) =>
        verifyDirectCandidates(
          {
            candidates,
            pageUrl,
            extraction,
            signal: verifySignal,
            mediaIdentity: directOfferIdentity(pageUrl) ?? `direct:${pageUrl}`,
          },
          defaultDirectVerifierDeps((request) => engine.probe(request)),
        ),
    },
  });

  const title = result.offer?.analysis.title ?? null;
  if (result.status !== 'SUPPORTED' || !result.offer || signal.aborted) {
    return {
      url,
      outcome: batchOutcomeFor({ verdict, analysisStatus: signal.aborted ? 'STALE' : result.status }),
      detail: result.status,
      title,
      downloadId: null,
    };
  }

  const pageUrl = result.finalUrl ?? url;
  const enqueue = await enqueueBrowserMediaDownload({
    analysis: result.offer.analysis,
    requestContext: result.offer.requestContext,
    fingerprint: result.offer.variantIdentity,
    pageUrl,
    contentIdentity: directOfferIdentity(pageUrl),
    isOfferCurrent: () => !signal.aborted,
  });
  return {
    url,
    outcome: batchOutcomeFor({ verdict, analysisStatus: result.status, enqueue }),
    detail: enqueue.ok ? (enqueue.duplicate ?? 'ENQUEUED') : (enqueue.reason ?? 'ENQUEUE_REJECTED'),
    title,
    downloadId: enqueue.ok ? (enqueue.downloadId ?? null) : null,
  };
}
