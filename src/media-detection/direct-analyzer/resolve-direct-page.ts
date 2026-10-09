/**
 * The direct analyzer for a pasted or shared link: fetch the page the way its tab would, find the page's own video in
 * its bytes, and have the existing classifier verify it — before the WebView plays anything. Every outcome is typed;
 * whatever is not SUPPORTED leaves the link to the WebView detection pipeline, which keeps running regardless.
 *
 *   link → policy → fetch (tab identity; cookies committed as the tab's navigation would) → media? → verify
 *                                                                                 → page → extract → verify
 *                   extract found nothing → declared player page (1 level) → desktop-site page → verify
 *
 * Pure orchestration: fetching and verifying are ports, so every branch is testable without a device.
 */

import type { PageFetchFailure, PageFetchResult } from '@modules/vidorax-media/src/VidoraMedia.types';

import { extractPageMedia, type DirectEvidence, type DirectMediaCandidate, type PageMediaExtraction } from './extract-page-media';
import { classifyMediaUrl, type DirectSourceKind } from './media-url';

export type DirectAnalysisStatus =
  | 'SUPPORTED'
  | 'PROTECTED'
  | 'LIVE_UNSUPPORTED'
  | 'UNSUPPORTED'
  | 'UNRESOLVED'
  | 'TRANSIENT_FAILURE'
  | 'INVALID_MEDIA'
  | 'STALE';

/** `tab`: the tab's own identity, first; `player`: a declared embedded-player page; `desktop`: the desktop site. */
export type DirectFetchMode = 'tab' | 'player' | 'desktop';

export type DirectFetchRecord = {
  mode: DirectFetchMode;
  outcome: 'document' | 'media' | PageFetchFailure;
  status: number | null;
  redirects: number;
  elapsedMs: number;
  candidates: number;
};

export type DirectVerification<TOffer> =
  | { ok: true; offer: TOffer; sourceKind: DirectSourceKind | 'split' | 'mixed'; variantCount: number }
  | { ok: false; outcome: Exclude<DirectAnalysisStatus, 'SUPPORTED' | 'STALE'>; reason: string };

export type DirectAnalyzerPorts<TOffer> = {
  fetchPage(request: { url: string; mode: DirectFetchMode; commitCookies: boolean; signal: AbortSignal }): Promise<PageFetchResult>;
  verify(input: {
    candidates: DirectMediaCandidate[];
    pageUrl: string;
    requestedUrl: string;
    extraction: PageMediaExtraction | null;
    signal: AbortSignal;
  }): Promise<DirectVerification<TOffer>>;
  now?: () => number;
};

export type DirectAnalysisResult<TOffer> = {
  status: DirectAnalysisStatus;
  /** A stable code for the outcome (never a URL). */
  reason: string;
  requestedUrl: string;
  /** The page (or file) the link ended at, after redirects. */
  finalUrl: string | null;
  pageFetched: boolean;
  fetches: DirectFetchRecord[];
  extraction: PageMediaExtraction | null;
  evidence: DirectEvidence | null;
  sourceKind: DirectSourceKind | 'split' | 'mixed' | null;
  variantCount: number;
  offer: TOffer | null;
  elapsedMs: number;
};

const POLICY_BLOCKED_HOSTS = ['youtube.com', 'youtu.be', 'googlevideo.com', 'youtube-nocookie.com'];

function isPolicyBlocked(host: string): boolean {
  const h = host.toLowerCase();
  return POLICY_BLOCKED_HOSTS.some((blocked) => h === blocked || h.endsWith(`.${blocked}`));
}

/** Literal private/loopback/link-local hosts; the native fetcher applies the full rule to every redirect hop. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(':') && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'));
}

/** What a failed page fetch means for the pasted link. */
export function outcomeForFetchFailure(
  code: PageFetchFailure,
  status: number | null,
): { status: Exclude<DirectAnalysisStatus, 'SUPPORTED' | 'STALE'>; reason: string } {
  switch (code) {
    case 'TIMEOUT':
    case 'NETWORK':
      return { status: 'TRANSIENT_FAILURE', reason: `FETCH_${code}` };
    case 'HTTP_ERROR':
      if (status != null && (status >= 500 || status === 408 || status === 429)) {
        return { status: 'TRANSIENT_FAILURE', reason: `HTTP_${status}` };
      }
      // A 4xx (login wall, removed post, geo block): the WebView shows the page for what it is.
      return { status: 'UNRESOLVED', reason: status != null ? `HTTP_${status}` : 'HTTP_ERROR' };
    case 'REDIRECT_LOOP':
    case 'TOO_MANY_REDIRECTS':
      return { status: 'UNRESOLVED', reason: code };
    case 'POLICY_BLOCKED':
      return { status: 'UNSUPPORTED', reason: 'POLICY_BLOCKED' };
    case 'UNSAFE_URL':
      return { status: 'INVALID_MEDIA', reason: 'UNSAFE_URL' };
    case 'UNSUPPORTED_CONTENT':
      return { status: 'INVALID_MEDIA', reason: 'NOT_MEDIA' };
    case 'INVALID_URL':
    default:
      return { status: 'INVALID_MEDIA', reason: 'INVALID_URL' };
  }
}

function kindOfMedia(contentType: string | null, url: string): DirectSourceKind | null {
  const type = (contentType ?? '').toLowerCase();
  if (/mpegurl/.test(type)) return 'hls';
  if (/dash\+xml|mpeg\.dash/.test(type)) return 'dash';
  const hint = classifyMediaUrl(url);
  if (hint?.kind) return hint.kind;
  return type.startsWith('video/') ? 'progressive' : null;
}

export async function analyzePastedLink<TOffer>(input: {
  url: string;
  signal: AbortSignal;
  ports: DirectAnalyzerPorts<TOffer>;
  /** Called once when the tab may start its own navigation (the first fetch settled, or none was needed). */
  onPageFetched?: () => void;
  /** Try the desktop site when the tab's page names no video (default true). */
  desktopRetry?: boolean;
  /** Diagnostics: each fetch as it settles, and each page as it has been read. */
  onStage?: (stage: { step: 'fetched' | 'extracted'; mode: DirectFetchMode; ms: number; candidates?: number }) => void;
}): Promise<DirectAnalysisResult<TOffer>> {
  const now = input.ports.now ?? Date.now;
  const started = now();
  const requestedUrl = input.url.trim();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      input.onPageFetched?.();
    }
  };
  const fetches: DirectFetchRecord[] = [];
  const result = (
    status: DirectAnalysisStatus,
    reason: string,
    extra: Partial<DirectAnalysisResult<TOffer>> = {},
  ): DirectAnalysisResult<TOffer> => {
    release();
    return {
      status,
      reason,
      requestedUrl,
      finalUrl: null,
      pageFetched: fetches.some((f) => f.outcome === 'document' || f.outcome === 'media'),
      fetches,
      extraction: null,
      evidence: null,
      sourceKind: null,
      variantCount: 0,
      offer: null,
      elapsedMs: now() - started,
      ...extra,
    };
  };
  const stale = () => result('STALE', 'SUPERSEDED');

  let parsed: URL;
  try {
    parsed = new URL(requestedUrl);
  } catch {
    return result('INVALID_MEDIA', 'INVALID_URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return result('INVALID_MEDIA', 'INVALID_URL');
  }
  if (isPolicyBlocked(parsed.hostname)) {
    return result('UNSUPPORTED', 'POLICY_BLOCKED');
  }
  if (isPrivateHost(parsed.hostname)) {
    return result('INVALID_MEDIA', 'UNSAFE_URL');
  }

  const fetchOnce = async (url: string, mode: DirectFetchMode): Promise<PageFetchResult | null> => {
    let fetched: PageFetchResult;
    try {
      fetched = await input.ports.fetchPage({ url, mode, commitCookies: mode === 'tab', signal: input.signal });
    } catch {
      fetched = { kind: 'failure', code: 'NETWORK', status: null, redirects: 0, elapsedMs: 0 };
    }
    input.onStage?.({ step: 'fetched', mode, ms: now() - started });
    fetches.push({
      mode,
      outcome: fetched.kind === 'failure' ? fetched.code : fetched.kind,
      status: fetched.kind === 'failure' ? fetched.status : fetched.status,
      redirects: fetched.redirects,
      elapsedMs: fetched.elapsedMs,
      candidates: 0,
    });
    return input.signal.aborted ? null : fetched;
  };

  let first: PageFetchResult | null;
  try {
    first = await fetchOnce(requestedUrl, 'tab');
  } finally {
    // The tab's navigation waits only for this first fetch: its cookies are in the jar now (or never will be).
    release();
  }
  if (!first) {
    return stale();
  }
  if (first.kind === 'failure') {
    const failure = outcomeForFetchFailure(first.code, first.status);
    return result(failure.status, failure.reason);
  }

  const verify = async (
    candidates: DirectMediaCandidate[],
    pageUrl: string,
    extraction: PageMediaExtraction | null,
  ): Promise<DirectAnalysisResult<TOffer>> => {
    const evidence = candidates[0]?.evidence ?? null;
    let verification: DirectVerification<TOffer>;
    try {
      verification = await input.ports.verify({ candidates, pageUrl, requestedUrl, extraction, signal: input.signal });
    } catch {
      verification = { ok: false, outcome: 'TRANSIENT_FAILURE', reason: 'VERIFY_FAILED' };
    }
    if (input.signal.aborted) {
      return stale();
    }
    const common = { finalUrl: pageUrl, extraction, evidence };
    if (verification.ok) {
      return result('SUPPORTED', 'VERIFIED', {
        ...common,
        offer: verification.offer,
        sourceKind: verification.sourceKind,
        variantCount: verification.variantCount,
      });
    }
    // The page's own flags explain a refusal the files could not (a live page whose stream was unreachable).
    if (verification.outcome === 'UNRESOLVED' || verification.outcome === 'TRANSIENT_FAILURE') {
      if (extraction?.protected) return result('PROTECTED', 'PROTECTED_PAGE', common);
      if (extraction?.live) return result('LIVE_UNSUPPORTED', 'LIVE_PAGE', common);
    }
    return result(verification.outcome, verification.reason, common);
  };

  if (first.kind === 'media') {
    const kind = kindOfMedia(first.contentType, first.finalUrl);
    const candidate: DirectMediaCandidate = {
      url: first.finalUrl,
      kind,
      audioUrl: null,
      evidence: 'direct',
      origin: 'direct_link',
      mimeType: first.contentType,
      width: null,
      height: null,
      bitrate: null,
      qualityLabel: null,
      durationMs: null,
    };
    fetches[fetches.length - 1]!.candidates = 1;
    return verify([candidate], first.finalUrl, null);
  }

  const pageUrl = first.finalUrl;
  let extraction = extractPageMedia({ html: first.body, pageUrl, requestedUrl });
  fetches[fetches.length - 1]!.candidates = extraction.candidates.length;
  input.onStage?.({ step: 'extracted', mode: 'tab', ms: now() - started, candidates: extraction.candidates.length });
  const pageMeta = { title: extraction.title, thumbnailUrl: extraction.thumbnailUrl, durationMs: extraction.durationMs };

  // A declared embedded player (one level): its page carries the player's configuration.
  if (extraction.candidates.length === 0 && extraction.playerPageUrls.length > 0) {
    const playerUrl = extraction.playerPageUrls[0]!;
    let host = '';
    try {
      host = new URL(playerUrl).hostname;
    } catch {
      host = '';
    }
    if (isPolicyBlocked(host)) {
      return result('UNSUPPORTED', 'POLICY_BLOCKED', { finalUrl: pageUrl, extraction });
    }
    const player = await fetchOnce(playerUrl, 'player');
    if (!player) {
      return stale();
    }
    if (player.kind === 'document') {
      const fromPlayer = extractPageMedia({ html: player.body, pageUrl: player.finalUrl, requestedUrl });
      fetches[fetches.length - 1]!.candidates = fromPlayer.candidates.length;
      if (fromPlayer.candidates.length > 0) {
        extraction = { ...fromPlayer, title: pageMeta.title ?? fromPlayer.title, thumbnailUrl: pageMeta.thumbnailUrl ?? fromPlayer.thumbnailUrl };
      }
    } else if (player.kind === 'media') {
      fetches[fetches.length - 1]!.candidates = 1;
      extraction = {
        ...extraction,
        candidates: [
          {
            url: player.finalUrl,
            kind: kindOfMedia(player.contentType, player.finalUrl),
            audioUrl: null,
            evidence: 'declared',
            origin: 'og_video',
            mimeType: player.contentType,
            width: null,
            height: null,
            bitrate: null,
            qualityLabel: null,
            durationMs: pageMeta.durationMs,
          },
        ],
      };
    }
  }

  // The desktop site: many sites render their media data only for desktop browsers.
  if (extraction.candidates.length === 0 && input.desktopRetry !== false && !extraction.live && !extraction.protected) {
    const desktop = await fetchOnce(requestedUrl, 'desktop');
    if (!desktop) {
      return stale();
    }
    if (desktop.kind === 'document') {
      const fromDesktop = extractPageMedia({ html: desktop.body, pageUrl: desktop.finalUrl, requestedUrl });
      fetches[fetches.length - 1]!.candidates = fromDesktop.candidates.length;
      input.onStage?.({ step: 'extracted', mode: 'desktop', ms: now() - started, candidates: fromDesktop.candidates.length });
      if (fromDesktop.candidates.length > 0 || fromDesktop.live || fromDesktop.protected) {
        extraction = {
          ...fromDesktop,
          title: fromDesktop.title ?? pageMeta.title,
          thumbnailUrl: fromDesktop.thumbnailUrl ?? pageMeta.thumbnailUrl,
        };
      }
    }
  }

  if (extraction.candidates.length === 0) {
    const common = { finalUrl: pageUrl, extraction };
    if (extraction.protected) return result('PROTECTED', 'PROTECTED_PAGE', common);
    if (extraction.live) return result('LIVE_UNSUPPORTED', 'LIVE_PAGE', common);
    return result('UNRESOLVED', extraction.ambiguous ? 'AMBIGUOUS_MEDIA' : 'NO_MEDIA_IN_PAGE', common);
  }
  return verify(extraction.candidates, pageUrl, extraction);
}
