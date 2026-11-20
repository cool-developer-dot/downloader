/**
 * Batch Add (#292): one link at a time through the existing direct analyzer (the same page fetch, extraction and
 * verification a pasted link gets — YouTube, private hosts, DRM and live are refused there as everywhere), and,
 * when it finds exactly one verified video, through the normal download path at the default quality
 * (`enqueueBrowserMediaDownload` → handoff → the engine's atomic duplicate check). Nothing is published to a tab.
 */

import { sizeAllowed, type LinkRules } from '@/downloads/bulk/link-rules';
import type { PageFetchRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import {
  BATCH_RETRY_DELAYS_MS,
  batchOutcomeFor,
  classifyIntakeLink,
  shouldRetryBatchCheck,
  type BatchOutcome,
} from '@/browser/services/link-intake';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { directOfferIdentity } from '@/media-detection/direct-analyzer/direct-offer-policy';
import {
  defaultDirectVerifierDeps,
  verifyDirectCandidates,
  type DirectOffer,
} from '@/media-detection/direct-analyzer/direct-verifier';
import { analyzePastedLink } from '@/media-detection/direct-analyzer/resolve-direct-page';

import { enqueueBrowserMediaDownload } from './browser-media-download.service';
import { isIncognitoInFront } from '@/browser/incognito/incognito-state';

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

/** What a bulk source adds to a run: #505 rules (the size rule is checked here, once the source's size is known). */
export type BatchLinkOptions = {
  rules?: LinkRules | null;
  /** The name the source gave the video (a feed item's or a playlist entry's title); it beats a bare file name. */
  title?: string | null;
};

export async function addLinkFromBatch(url: string, signal: AbortSignal, options: BatchLinkOptions = {}): Promise<BatchLinkResult> {
  const verdict = classifyIntakeLink(url);
  if (verdict !== 'ok') {
    return { url, outcome: 'refused', detail: verdict.toUpperCase(), title: null, downloadId: null };
  }
  const engine = getV2Engine();
  if (!engine?.fetchPage) {
    return { url, outcome: 'needs-review', detail: 'UNAVAILABLE', title: null, downloadId: null };
  }

  const analyze = () => analyzePastedLink<DirectOffer>({
    url,
    signal,
    ports: {
      fetchPage: async ({ url: pageUrl, mode, commitCookies }) => {
        const request: PageFetchRequest = {
          url: pageUrl,
          // Mobile reads use the WebView's own User-Agent (omitted); the desktop retry asks for the desktop site.
          userAgent: mode === 'desktop' ? buildBrowserUserAgent({ desktop: true }) : undefined,
          // B11: a link opened from an incognito tab is read without (and never stores) the normal profile's cookies.
          useSessionCookies: !isIncognitoInFront(),
          commitCookies: commitCookies && !isIncognitoInFront(),
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

  let result = await analyze();
  // A transient failure (timeout, dropped connection) is checked again before the link is called "needs review".
  for (let attempt = 1; shouldRetryBatchCheck(result.status, attempt) && !signal.aborted; attempt += 1) {
    await abortableDelay(BATCH_RETRY_DELAYS_MS[attempt - 1]!, signal);
    if (signal.aborted) {
      break;
    }
    result = await analyze();
  }

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

  // #505: a size rule refuses a video whose size the check found outside it (an unknown size passes).
  const sizeBytes = Number(result.offer.analysis.fileSize ?? NaN);
  if (options.rules && !sizeAllowed(Number.isFinite(sizeBytes) ? sizeBytes : null, options.rules)) {
    return { url, outcome: 'refused', detail: 'SIZE_RULE', title, downloadId: null };
  }

  const pageUrl = result.finalUrl ?? url;
  const sourceTitle = options.title?.trim().slice(0, 300) || null;
  const enqueue = await enqueueBrowserMediaDownload({
    analysis: sourceTitle ? { ...result.offer.analysis, title: sourceTitle } : result.offer.analysis,
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

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}
