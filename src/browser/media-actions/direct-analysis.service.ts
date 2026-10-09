/**
 * Runs the direct analyzer for a link pasted or shared into a tab, and turns a verified result into that tab's normal
 * "Video available" offer — the same CTA state, quality sheet, hand-off, duplicate check and engine the WebView
 * pipeline uses. One session per tab: a newer paste supersedes the older one (its result is STALE and never shown).
 *
 * The tab's own navigation starts as soon as the first page fetch settles (`onRelease`), so cookies the page set
 * (a session-signed media link) are already in the WebView jar when the tab loads the same page. Whatever the
 * analyzer does not resolve, the WebView detection pipeline — running for the page anyway — still handles.
 */

import type { PageFetchRequest } from '@modules/vidorax-media/src/VidoraMedia.types';

import { buildBrowserUserAgent } from '@/browser/constants/user-agent';
import { useBrowserStore } from '@/browser/stores';
import { getV2Engine } from '@/downloads/v2/engine-port';
import { contentTokensOf } from '@/media-detection/direct-analyzer/content-tokens';
import {
  decideDirectPublish,
  directOfferIdentity,
  isOtherMediaPlaying,
  matchesDirectPage,
} from '@/media-detection/direct-analyzer/direct-offer-policy';
import {
  defaultDirectVerifierDeps,
  verifyDirectCandidates,
  type DirectOffer,
} from '@/media-detection/direct-analyzer/direct-verifier';
import type { DirectMediaCandidate } from '@/media-detection/direct-analyzer/extract-page-media';
import {
  analyzePastedLink,
  type DirectAnalysisResult,
  type DirectAnalysisStatus,
  type DirectFetchMode,
} from '@/media-detection/direct-analyzer/resolve-direct-page';
import { generalPageMediaContextStore } from '@/media-detection/general-media';
import { recordPipelineOutcome, type PipelineOutcome } from '@/media-detection/pipeline/pipeline-outcome';
import { resolveSocialPlatform, socialPageContextStore } from '@/media-detection/social';
import { useMediaDetectionStore } from '@/media-detection/stores';
import { isSameDocumentUrl } from '@/media-detection/utils';

import { browserMediaActionService } from './browser-media-action.service';

/** The tab's navigation waits at most this long for the first page fetch. */
const TAB_FETCH_TIMEOUT_MS = 6_000;
const OTHER_FETCH_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 3 * 1024 * 1024;
/** Safety net over the native deadline: the tab never waits longer than this, whatever happens. */
const RELEASE_DEADLINE_MS = TAB_FETCH_TIMEOUT_MS + 1_500;
/**
 * How long a verified result may wait for its page to become current, and then keeps following it (a same-page reset
 * re-offers it; a URL rewrite of the same content moves it along).
 */
const PUBLISH_WINDOW_MS = 120_000;
const MAX_REPUBLISH = 4;

const TRACE_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_VIDORAX_PIPELINE_TRACE === '1';

export type DirectSessionSnapshot = {
  id: number;
  tabId: string;
  status: DirectAnalysisStatus | 'RUNNING';
  reason: string | null;
  published: boolean;
  publishDecision: string | null;
};

type DirectOfferState = {
  offer: DirectOffer;
  sourceKind: DirectAnalysisResult<DirectOffer>['sourceKind'];
  variantCount: number;
  evidence: DirectAnalysisResult<DirectOffer>['evidence'];
  final: boolean;
};

type Session = {
  id: number;
  tabId: string;
  url: string;
  controller: AbortController;
  startedAt: number;
  released: boolean;
  result: DirectAnalysisResult<DirectOffer> | null;
  /** The best verified offer so far: the whole files first (early), then the final one. */
  offer: DirectOfferState | null;
  pageUrls: string[];
  tokens: Set<string>;
  navigationSeen: boolean;
  published: boolean;
  /** Re-entrancy: the CTA service notifies subscribers synchronously while an offer is being handed over. */
  publishing: boolean;
  watching: boolean;
  publishedOffer: DirectOffer | null;
  publishedIdentity: string | null;
  publishedNavigation: string | null;
  republished: number;
  lastDecision: string | null;
  cleanup: (() => void)[];
  finished: boolean;
  tabDesktop: boolean;
};

/** The sources a tab's published direct offer names, so a late tap can refresh their signed links. */
type PublishedSources = {
  tabId: string;
  requestedUrl: string;
  pageUrls: string[];
  tokens: Set<string>;
  tabDesktop: boolean;
  fileKeys: Set<string>;
  verifiedAt: number;
};

const sessions = new Map<string, Session>();
const publishedSources = new Map<string, PublishedSources>();
/** A direct offer's links are re-read from the page when tapped this long after they were verified. */
const REFRESH_AFTER_MS = 90_000;
const REFRESH_TIMEOUT_MS = 15_000;
let nextSessionId = 1;
const snapshots = new Map<string, DirectSessionSnapshot>();

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function logDirect(event: string, fields: Record<string, unknown>): void {
  if (TRACE_ENABLED) {
    console.log('[VidoraDirect]', JSON.stringify({ event, ...fields }));
  }
}

function outcomeOf(status: DirectAnalysisStatus): PipelineOutcome {
  switch (status) {
    case 'SUPPORTED':
      return 'OBSERVED';
    case 'UNRESOLVED':
      return 'SOURCE_UNRESOLVED';
    default:
      return status;
  }
}

function snapshot(session: Session): void {
  snapshots.set(session.tabId, {
    id: session.id,
    tabId: session.tabId,
    status: session.result?.status ?? 'RUNNING',
    reason: session.result?.reason ?? null,
    published: session.published,
    publishDecision: session.lastDecision,
  });
}

function finish(session: Session, reason: string): void {
  if (session.finished) return;
  session.finished = true;
  for (const dispose of session.cleanup.splice(0)) {
    try {
      dispose();
    } catch {
      // ignore
    }
  }
  if (sessions.get(session.tabId) === session) {
    sessions.delete(session.tabId);
  }
  logDirect('session_end', { sessionId: session.id, tabId: session.tabId, reason, published: session.published });
  snapshot(session);
}

function userAgentFor(mode: DirectFetchMode, tabDesktop: boolean): string | undefined {
  // Mobile tabs never override the WebView's stock User-Agent: omitted, the native side uses that same one.
  return mode === 'desktop' || tabDesktop ? buildBrowserUserAgent({ desktop: true }) : undefined;
}

/** What the tab's player shows right now, as the WebView pipeline identifies it (null before any player evidence). */
function liveMediaIdentityOf(tabId: string, pageUrl: string): string | null {
  return resolveSocialPlatform(pageUrl)
    ? (socialPageContextStore.get(tabId)?.currentVisibleMediaIdentity ?? null)
    : (generalPageMediaContextStore.get(tabId)?.currentMediaIdentity ?? null);
}

function tabOf(tabId: string) {
  return useBrowserStore.getState().tabs.find((tab) => tab.id === tabId) ?? null;
}

/** Whether this build can run the direct analyzer (the native page fetcher is present). */
export function isDirectAnalysisAvailable(): boolean {
  return typeof getV2Engine()?.fetchPage === 'function';
}

function tryPublish(session: Session): void {
  const state = session.offer;
  if (!state || session.finished || session.publishing) {
    return;
  }
  const tab = tabOf(session.tabId);
  if (tab && matchesDirectPage(tab.url, session.pageUrls, session.tokens)) {
    session.navigationSeen = true;
  }
  const detection = useMediaDetectionStore.getState();
  // The offer is written to the CTA service's active slice: the browser and the service must agree on the tab.
  const storeActiveTabId = useBrowserStore.getState().activeTabId;
  const activeTabId = browserMediaActionService.getActiveTabId() === storeActiveTabId ? storeActiveTabId : null;
  const slice =
    browserMediaActionService.getActiveTabId() === session.tabId ? browserMediaActionService.getState() : null;
  // The CTA shows only for the page the browser shows: its URL, once it is the session's page.
  const pageUrl =
    (tab && matchesDirectPage(tab.url, session.pageUrls, session.tokens) ? tab.url : null) ??
    detection.lastNavigation ??
    session.pageUrls[1] ??
    session.url;
  const identity = directOfferIdentity(pageUrl);
  const liveMediaIdentity = liveMediaIdentityOf(session.tabId, pageUrl);

  // After publishing: the final result may add a better quality to the offer still standing unchanged; and only a
  // navigation inside the same page (a redirect, a tracking rewrite) may re-offer it — a withdrawal by the page's own
  // evidence (protection, a different video playing) stands.
  if (session.published) {
    const ours =
      slice != null &&
      slice.status === 'verified' &&
      !slice.selectionLocked &&
      slice.contentIdentity === session.publishedIdentity &&
      slice.mediaUrl === session.publishedOffer?.mediaUrl;
    if (ours && state.offer !== session.publishedOffer) {
      handOver(session, state, pageUrl, session.publishedIdentity, 'upgraded');
      return;
    }
    // The page rewrote its URL for the same content (`&vanity=…`, a canonical redirect): the offer follows it, or the
    // CTA would stay hidden as belonging to the previous URL.
    if (
      ours &&
      slice != null &&
      !isOtherMediaPlaying(session.publishedIdentity, liveMediaIdentity) &&
      !isSameDocumentUrl(slice.pageUrl, pageUrl) &&
      matchesDirectPage(pageUrl, session.pageUrls, session.tokens) &&
      matchesDirectPage(detection.lastNavigation, session.pageUrls, session.tokens) &&
      session.republished < MAX_REPUBLISH
    ) {
      session.republished += 1;
      handOver(session, state, pageUrl, directOfferIdentity(pageUrl) ?? session.publishedIdentity, 'followed');
      return;
    }
    const reset =
      slice != null &&
      slice.status === 'idle' &&
      !slice.mediaFingerprint &&
      detection.lastNavigation !== session.publishedNavigation;
    if (!reset || session.republished >= MAX_REPUBLISH) {
      return;
    }
  }

  const decision = decideDirectPublish({
    sessionTabId: session.tabId,
    activeTabId,
    tabExists: tab != null,
    tabUrl: tab?.url ?? null,
    lastNavigation: detection.lastNavigation,
    pageUrls: session.pageUrls,
    contentTokens: session.tokens,
    navigationSeen: session.navigationSeen,
    offer: {
      status: slice?.status ?? 'idle',
      contentIdentity: slice?.contentIdentity ?? null,
      selectionLocked: slice?.selectionLocked ?? false,
    },
    offerIdentity: identity,
    liveMediaIdentity,
    identityConsumed: slice != null && browserMediaActionService.isContentIdentityConsumed(identity),
  });
  const decisionKey = decision.action === 'publish' ? 'publish' : `${decision.action}:${decision.reason}`;
  if (decisionKey !== session.lastDecision) {
    session.lastDecision = decisionKey;
    logDirect('publish_decision', { sessionId: session.id, tabId: session.tabId, decision: decisionKey });
    snapshot(session);
  }
  if (decision.action === 'wait') {
    return;
  }
  if (decision.action === 'stale' || decision.action === 'skip') {
    if (!session.published) {
      recordPipelineOutcome({
        tabId: session.tabId,
        pageUrl,
        mediaUrl: state.offer.mediaUrl,
        stage: 'offer',
        outcome: decision.action === 'stale' ? 'STALE' : 'OBSERVED',
        reason: `DIRECT_${decision.reason}`,
      });
    }
    // A final result may still be on its way for a standing early offer: keep watching until it lands.
    if (!(session.published && !state.final && decision.action === 'skip')) {
      finish(session, decisionKey);
    }
    return;
  }
  if (session.published) {
    session.republished += 1;
  }
  handOver(session, state, pageUrl, identity, session.published ? 'republished' : 'offered');
}

function handOver(
  session: Session,
  state: DirectOfferState,
  pageUrl: string,
  identity: string | null,
  event: 'offered' | 'republished' | 'upgraded' | 'followed',
): void {
  const { offer } = state;
  // Recorded before the hand-over: subscribers run synchronously inside it and must see this offer as ours.
  session.publishing = true;
  session.published = true;
  session.publishedOffer = offer;
  session.publishedIdentity = identity;
  session.publishedNavigation = useMediaDetectionStore.getState().lastNavigation;
  try {
    browserMediaActionService.handoffVerified({
      pageUrl,
      media: { ...offer.media, pageUrl },
      analysis: offer.analysis,
      requestContext: offer.requestContext,
      mediaUrl: offer.mediaUrl,
      autoShow: event === 'offered' || event === 'republished',
      contentIdentity: identity,
      variantIdentity: offer.variantIdentity,
    });
  } finally {
    session.publishing = false;
  }
  const fileKeys = new Set<string>();
  for (const variant of offer.analysis.variants ?? []) {
    fileKeys.add(fileKeyOf(variant.sourceUrl));
    if (variant.audioSourceUrl) fileKeys.add(fileKeyOf(variant.audioSourceUrl));
  }
  fileKeys.add(fileKeyOf(offer.mediaUrl));
  publishedSources.set(session.tabId, {
    tabId: session.tabId,
    requestedUrl: session.url,
    pageUrls: session.pageUrls,
    tokens: session.tokens,
    tabDesktop: session.tabDesktop,
    fileKeys,
    verifiedAt: offer.requestContext.capturedAt ?? Date.now(),
  });
  if (event === 'offered' || event === 'republished') {
    recordPipelineOutcome({
      tabId: session.tabId,
      pageUrl,
      mediaUrl: offer.mediaUrl,
      stage: 'offer',
      outcome: 'OFFERED',
      reason: `DIRECT_${state.evidence ?? 'page'}`.toUpperCase(),
    });
  }
  logDirect(event, {
    sessionId: session.id,
    tabId: session.tabId,
    pageHost: hostOf(pageUrl),
    mediaHost: hostOf(offer.mediaUrl),
    sourceKind: state.sourceKind,
    variants: state.variantCount,
    evidence: state.evidence,
    final: state.final,
    sinceStartMs: Date.now() - session.startedAt,
    republished: session.republished,
  });
  snapshot(session);
}

function watchForPublish(session: Session): void {
  if (session.watching || session.finished) {
    tryPublish(session);
    return;
  }
  session.watching = true;
  const evaluate = () => tryPublish(session);
  session.cleanup.push(useBrowserStore.subscribe(evaluate));
  session.cleanup.push(useMediaDetectionStore.subscribe(evaluate));
  session.cleanup.push(browserMediaActionService.subscribe(evaluate));
  const timer = setTimeout(() => finish(session, session.published ? 'window_closed' : 'publish_timeout'), PUBLISH_WINDOW_MS);
  session.cleanup.push(() => clearTimeout(timer));
  evaluate();
}

/**
 * Starts the direct analyzer for `url` in `tabId`. `onRelease` is called exactly once, when the tab may start its own
 * navigation to the link (the first fetch settled, or the deadline passed). Returns the session id.
 */
export function startDirectAnalysis(input: {
  tabId: string;
  url: string;
  source: 'omnibox' | 'share';
  onRelease: () => void;
}): number {
  const prior = sessions.get(input.tabId);
  if (prior) {
    prior.controller.abort();
    recordPipelineOutcome({ tabId: prior.tabId, pageUrl: prior.url, mediaUrl: null, stage: 'resolver', outcome: 'STALE', reason: 'DIRECT_SUPERSEDED' });
    finish(prior, 'superseded');
  }

  const session: Session = {
    id: nextSessionId++,
    tabId: input.tabId,
    url: input.url,
    controller: new AbortController(),
    startedAt: Date.now(),
    released: false,
    result: null,
    offer: null,
    pageUrls: [input.url],
    tokens: contentTokensOf([input.url]),
    navigationSeen: false,
    published: false,
    publishing: false,
    watching: false,
    publishedOffer: null,
    publishedIdentity: null,
    publishedNavigation: null,
    republished: 0,
    lastDecision: null,
    cleanup: [],
    finished: false,
    tabDesktop: Boolean(tabOf(input.tabId)?.desktopMode),
  };
  sessions.set(input.tabId, session);
  snapshot(session);

  const release = () => {
    if (session.released) return;
    session.released = true;
    logDirect('navigation_released', { sessionId: session.id, tabId: session.tabId, afterMs: Date.now() - session.startedAt });
    input.onRelease();
  };
  const releaseTimer = setTimeout(release, RELEASE_DEADLINE_MS);

  const engine = getV2Engine();
  const tabDesktop = session.tabDesktop;
  logDirect('start', { sessionId: session.id, tabId: input.tabId, host: hostOf(input.url), source: input.source });

  void analyzePastedLink<DirectOffer>({
    url: input.url,
    signal: session.controller.signal,
    desktopRetry: !tabDesktop,
    onPageFetched: release,
    onStage: (stage) => logDirect(`stage_${stage.step}`, { sessionId: session.id, mode: stage.mode, ms: stage.ms, candidates: stage.candidates ?? null }),
    ports: {
      fetchPage: async ({ url, mode, commitCookies }) => {
        if (!engine?.fetchPage) {
          return { kind: 'failure', code: 'NETWORK', status: null, redirects: 0, elapsedMs: 0 };
        }
        const request: PageFetchRequest = {
          url,
          userAgent: userAgentFor(mode, tabDesktop),
          useSessionCookies: true,
          commitCookies,
          timeoutMs: mode === 'tab' ? TAB_FETCH_TIMEOUT_MS : OTHER_FETCH_TIMEOUT_MS,
          maxBytes: PAGE_MAX_BYTES,
        };
        return engine.fetchPage(request);
      },
      verify: ({ candidates, pageUrl, extraction, signal }) => {
        logDirect('verify_start', {
          sessionId: session.id,
          candidates: candidates.map((c) => `${c.evidence}/${c.origin}/${c.kind ?? 'bytes'}`),
          sinceStartMs: Date.now() - session.startedAt,
        });
        const deps = defaultDirectVerifierDeps(engine ? (request) => engine.probe(request) : null);
        return verifyDirectCandidates(
          {
            candidates,
            pageUrl,
            extraction,
            signal,
            mediaIdentity: directOfferIdentity(pageUrl) ?? `direct:${pageUrl}`,
            // The whole files are enough to show the offer; a split pair still being proven only adds a quality.
            onEarlyOffer: (early) => {
              if (signal.aborted || session.finished) return;
              session.pageUrls = [input.url, pageUrl, extraction?.canonicalUrl ?? ''].filter(Boolean);
              session.tokens = contentTokensOf(session.pageUrls);
              session.offer = {
                offer: early.offer,
                sourceKind: early.sourceKind,
                variantCount: early.variantCount,
                evidence: candidates[0]?.evidence ?? null,
                final: false,
              };
              logDirect('early_offer', { sessionId: session.id, tabId: session.tabId, variants: early.variantCount, sinceStartMs: Date.now() - session.startedAt });
              watchForPublish(session);
            },
          },
          {
            ...deps,
            verifyCandidate: async (media, verifyInput) => {
              const started = Date.now();
              const verdict = await deps.verifyCandidate(media, verifyInput);
              logDirect('candidate_verified', {
                sessionId: session.id,
                ok: verdict.ok,
                reason: verdict.ok ? null : verdict.reason,
                session: verifyInput.requestContext.authMode !== 'PUBLIC',
                ms: Date.now() - started,
              });
              return verdict;
            },
          },
        );
      },
    },
  })
    .then((result) => {
      clearTimeout(releaseTimer);
      release();
      session.result = result;
      const pageUrl = result.finalUrl ?? input.url;
      session.pageUrls = [input.url, pageUrl, result.extraction?.canonicalUrl ?? ''].filter(Boolean);
      session.tokens = contentTokensOf(session.pageUrls);
      recordPipelineOutcome({
        tabId: session.tabId,
        pageUrl,
        mediaUrl: result.offer?.mediaUrl ?? result.extraction?.candidates[0]?.url ?? null,
        stage: 'resolver',
        outcome: outcomeOf(result.status),
        reason: `DIRECT_${result.reason}`,
      });
      logDirect('result', {
        sessionId: session.id,
        tabId: session.tabId,
        host: hostOf(input.url),
        finalHost: hostOf(result.finalUrl),
        status: result.status,
        reason: result.reason,
        pageFetched: result.pageFetched,
        evidence: result.evidence,
        sourceKind: result.sourceKind,
        variants: result.variantCount,
        candidates: result.extraction?.candidates.length ?? (result.evidence === 'direct' ? 1 : 0),
        mediaUrls: result.extraction?.mediaUrlCount ?? null,
        fetches: result.fetches.map((f) => `${f.mode}:${f.outcome}:${f.status ?? '-'}:${f.elapsedMs}ms:${f.candidates}`),
        elapsedMs: result.elapsedMs,
        webViewFallback: result.status !== 'SUPPORTED',
      });
      snapshot(session);
      if (result.status === 'SUPPORTED' && result.offer && !session.controller.signal.aborted) {
        session.offer = {
          offer: result.offer,
          sourceKind: result.sourceKind,
          variantCount: result.variantCount,
          evidence: result.evidence,
          final: true,
        };
        watchForPublish(session);
      } else {
        finish(session, `result:${result.status}`);
      }
    })
    .catch(() => {
      clearTimeout(releaseTimer);
      release();
      finish(session, 'error');
    });

  return session.id;
}

function fileKeyOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase()}${parsed.pathname}`;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

/**
 * A direct offer tapped long after it was verified: its signed links may have run out (the pre-download gate treats a
 * signed link without a readable expiry as expired after a while), and unlike a playing page nothing re-requested
 * them. The page is read again (no cookies committed, nothing verified — the engine's own probe checks the file) and
 * the same file's current link returned. Null when the source is not a direct offer's, is still fresh, or the page no
 * longer names that file.
 */
export async function refreshStaleDirectSource(input: {
  pageUrl: string | null;
  sourceUrl: string;
  audioSourceUrl?: string | null;
  verifiedAtMs: number | null;
}): Promise<{ sourceUrl: string; audioSourceUrl: string | null; verifiedAt: number } | null> {
  const key = fileKeyOf(input.sourceUrl);
  const record = [...publishedSources.values()].find(
    (r) => r.fileKeys.has(key) && (!input.pageUrl || matchesDirectPage(input.pageUrl, r.pageUrls, r.tokens)),
  );
  const engine = getV2Engine();
  if (!record || !engine?.fetchPage) {
    return null;
  }
  const verifiedAt = input.verifiedAtMs ?? record.verifiedAt;
  if (Date.now() - verifiedAt < REFRESH_AFTER_MS) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
  try {
    const result = await analyzePastedLink<DirectMediaCandidate[]>({
      url: record.requestedUrl,
      signal: controller.signal,
      desktopRetry: !record.tabDesktop,
      ports: {
        fetchPage: ({ url, mode }) =>
          engine.fetchPage!({
            url,
            userAgent: userAgentFor(mode, record.tabDesktop),
            useSessionCookies: true,
            commitCookies: false,
            timeoutMs: OTHER_FETCH_TIMEOUT_MS,
            maxBytes: PAGE_MAX_BYTES,
          }),
        verify: async ({ candidates }) => ({ ok: true, offer: candidates, sourceKind: 'progressive', variantCount: candidates.length }),
      },
    });
    const match = result.offer?.find(
      (candidate) =>
        fileKeyOf(candidate.url) === key &&
        (!input.audioSourceUrl || (candidate.audioUrl != null && fileKeyOf(candidate.audioUrl) === fileKeyOf(input.audioSourceUrl))),
    );
    logDirect('source_refresh', { tabId: record.tabId, status: result.status, matched: Boolean(match), ageMs: Date.now() - verifiedAt });
    if (!match) {
      return null;
    }
    record.verifiedAt = Date.now();
    return { sourceUrl: match.url, audioSourceUrl: match.audioUrl, verifiedAt: record.verifiedAt };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Ends the tab's session (tab closed, or a navigation the user started elsewhere). */
export function cancelDirectAnalysis(tabId: string, reason: string): void {
  const session = sessions.get(tabId);
  if (!session) return;
  session.controller.abort();
  finish(session, reason);
}

export function isDirectSessionCurrent(tabId: string, sessionId: number): boolean {
  return sessions.get(tabId)?.id === sessionId && !sessions.get(tabId)?.controller.signal.aborted;
}

/** Diagnostics and tests: the last session's state per tab. */
export function getDirectAnalysisSnapshot(tabId: string): DirectSessionSnapshot | null {
  return snapshots.get(tabId) ?? null;
}
