/**
 * End-to-end rig for the live detection pipeline, used by `dynamic-detection.test.ts`.
 *
 * It wires exactly what the app wires — no shortcuts, no second detector:
 *
 *   PageHarness (real injected script in a vm DOM)
 *     → engine.handleWebViewMessage()            (what BrowserWebView.onMessage does)
 *     → useMediaDetectionStore + page context    (scoped candidate)
 *     → selectDiscoveryMedia()                   (correlation, the same call useMediaDiscovery makes)
 *     → buildVerifiedGeneralMediaOffer()         (verification)
 *     → offer                                    ("Video available")
 *
 * `fetch` is stubbed per test so verification runs for real against declared responses.
 *
 * Test-only. Never imported by app code.
 */
import { mediaDetectionEngine } from '../engine/media-detection.engine';
import { buildOwnershipKey, selectDiscoveryMedia } from '../hooks/discovery-selection';
import { generalPageMediaContextStore } from '../general-media/general-page-context';
import { selectCurrentMediaForActiveGeneralTab } from '../general-media/general-correlation.service';
import { buildVerifiedGeneralMediaOffer } from '../general-source/general-source-reliability.service';
import type { VerifiedGeneralMediaOffer } from '../general-source/types';
import { filterCorrelatedCandidates } from '../services/media-correlation.service';
import {
  classifyMsePlayback,
  getMsePlaybackContext,
  getMsePlaybackState,
  type MsePlaybackResolution,
  type MsePlaybackState,
} from '../engine/mse-playback-context';
import { clearAllVerificationSessions } from '../social-source/verification-session';
import { useMediaDetectionStore } from '../stores';
import type { DetectedMedia } from '../types';

import { PageHarness, type HarnessOptions } from './page-harness';

export type StubResponse = {
  status?: number;
  contentType?: string;
  /** Full resource size; the range probe reports it as the Content-Range total. */
  totalBytes?: number;
  finalUrl?: string;
  /** Text body, for a manifest. Omit for the default progressive-MP4 byte prefix. */
  body?: string;
  /** Container the served bytes should look like. Defaults to a progressive MP4. */
  container?: 'mp4' | 'webm';
};

type FetchStub = (url: string, init: { method?: string; headers?: Record<string, string> }) => StubResponse | null;

let installedFetch: typeof globalThis.fetch | undefined;

/** A WebM/Matroska prefix: the EBML magic is all the verifier's signature check looks for. */
export function webmPrefix(): Uint8Array {
  const bytes = new Uint8Array(16 * 1024);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3], 0);
  return bytes;
}

/**
 * A believable progressive MP4 prefix: `ftyp` + `moov` + the start of `mdat`, which is exactly
 * what the real verifier's bounded signature probe classifies as PROGRESSIVE_OR_COMPLETE.
 */
export function progressiveMp4Prefix(totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(16 * 1024);
  const view = new DataView(bytes.buffer);
  const writeBox = (offset: number, size: number, type: string): void => {
    view.setUint32(offset, size);
    for (let i = 0; i < 4; i += 1) bytes[offset + 4 + i] = type.charCodeAt(i);
  };
  writeBox(0, 32, 'ftyp');
  for (const [i, c] of [...'isomiso2avc1mp41'].entries()) bytes[8 + i] = c.charCodeAt(0);
  writeBox(32, 2_048, 'moov');
  writeBox(32 + 2_048, Math.max(1, totalBytes - 32 - 2_048), 'mdat');
  return bytes;
}

/** Installs a `fetch` that answers only what the test declares; anything else fails the probe. */
export function stubFetch(handler: FetchStub): void {
  installedFetch ??= globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { method?: string; headers?: Record<string, string> }) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const stub = handler(url, init ?? {});
    if (!stub) {
      throw new Error(`no stub for ${url}`);
    }
    const total = stub.totalBytes ?? 5_000_000;
    const method = init?.method ?? 'GET';
    const range = init?.headers?.Range ?? init?.headers?.range ?? null;
    const headers = new Map<string, string>();
    if (stub.contentType) headers.set('content-type', stub.contentType);
    headers.set('accept-ranges', 'bytes');

    let status = stub.status ?? 200;
    let payload: Uint8Array | null = null;
    if (stub.body != null) {
      payload = new TextEncoder().encode(stub.body);
      headers.set('content-length', String(payload.byteLength));
    } else if (method === 'HEAD') {
      headers.set('content-length', String(total));
    } else if (range) {
      const end = Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? 0);
      const length = Math.min(end + 1, total);
      payload = (stub.container === 'webm' ? webmPrefix() : progressiveMp4Prefix(total)).subarray(0, length);
      status = stub.status ?? 206;
      headers.set('content-range', `bytes 0-${length - 1}/${total}`);
      headers.set('content-length', String(length));
    } else {
      payload = stub.container === 'webm' ? webmPrefix() : progressiveMp4Prefix(total);
      headers.set('content-length', String(total));
    }

    const bodyBytes = payload;
    return {
      ok: status >= 200 && status < 400,
      status,
      url: stub.finalUrl ?? url,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: async () => stub.body ?? '',
      arrayBuffer: async () => (bodyBytes ? bodyBytes.slice().buffer : new ArrayBuffer(0)),
      body: bodyBytes
        ? new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bodyBytes.slice());
              controller.close();
            },
          })
        : null,
    } as unknown as Response;
  }) as typeof globalThis.fetch;
}

export function restoreFetch(): void {
  if (installedFetch) globalThis.fetch = installedFetch;
}

/** A plain progressive MP4 host that answers every probe with a complete `video/mp4`. */
export function mp4Everywhere(): FetchStub {
  return () => ({ contentType: 'video/mp4', totalBytes: 5_000_000 });
}

export type PipelineRig = {
  harness: PageHarness;
  tabId: string;
  /** Delivers everything the page has posted so far into the engine, like WebView.onMessage. */
  pump: () => void;
  /** Advances the page clock, then pumps. */
  tick: (ms?: number) => void;
  /** A new top-level document load in the same tab. */
  navigate: (url: string, options?: HarnessOptions) => void;
  /**
   * A new document the page itself navigated to — a link, a form, Back/Forward. The browser does not start a new
   * navigation epoch for these (only its own loads and reloads do): the chrome only reports the new URL.
   */
  linkNavigate: (url: string, options?: HarnessOptions) => void;
  /** The toolbar's reload: a new document for the same URL and a new navigation epoch. */
  reload: () => void;
  /** The current navigation epoch of this tab, as the browser counts it. */
  readonly epoch: number;
  /**
   * The browser chrome catching up with an SPA route change (`onNavigationStateChange` → store →
   * `useMediaDetectionBrowserSync`). Same navigation epoch: no document was loaded.
   */
  chromeSpaSync: (url: string) => void;
  /**
   * A request the patched WebView observed natively (`modules/vidorax-web` → `native-network.adapter`).
   * This is the only way media requested by a cross-origin player frame ever reaches the pipeline.
   * `epochOverride` / `pageUrlOverride` let a test deliver a genuinely stale observation.
   */
  observeNativeRequest: (input: {
    url: string;
    frameUrl?: string;
    mimeType?: string | null;
    epochOverride?: number;
    pageUrlOverride?: string;
  }) => void;
  /** What a blob/MediaSource player on this tab currently amounts to. */
  mseResolution: (hasWholeSourceCandidate?: boolean) => MsePlaybackResolution;
  /** The scoped blob/MSE evidence for this tab, or null when nothing is live. */
  mseState: () => MsePlaybackState | null;
  /** Candidates as `useMediaDiscovery` computes them. */
  candidates: () => DetectedMedia[];
  /** The media `useMediaDiscovery` would select right now. */
  selected: () => DetectedMedia | null;
  /** Runs correlation + verification and returns the published offer, or the rejection reason. */
  offer: () => Promise<
    { ok: true; offer: VerifiedGeneralMediaOffer; url: string } | { ok: false; reason: string }
  >;
};

export function resetPipeline(): void {
  mediaDetectionEngine.stop();
  useMediaDetectionStore.getState().reset();
  generalPageMediaContextStore.clearAll();
  clearAllVerificationSessions();
}

export function createPipeline(
  pageUrl: string,
  options: { tabId?: string; epoch?: number; title?: string } = {},
): PipelineRig {
  const tabId = options.tabId ?? 'tab-1';
  let epoch = options.epoch ?? 1;

  resetPipeline();
  mediaDetectionEngine.start();
  mediaDetectionEngine.setActiveTab(tabId);
  mediaDetectionEngine.onNavigationStart(pageUrl, epoch, tabId);

  let harness = new PageHarness({ url: pageUrl, title: options.title });

  const pump = (): void => {
    const pending = harness.messages.slice();
    harness.clearMessages();
    for (const message of pending) {
      mediaDetectionEngine.handleWebViewMessage(message.raw);
    }
  };

  const rig: PipelineRig = {
    get harness() {
      return harness;
    },
    tabId,
    pump,
    tick(ms = 600) {
      harness.advance(ms);
      pump();
    },
    navigate(url, harnessOptions) {
      epoch += 1;
      mediaDetectionEngine.onNavigationStart(url, epoch, tabId);
      harness = new PageHarness(harnessOptions ?? { url });
    },
    linkNavigate(url, harnessOptions) {
      mediaDetectionEngine.onNavigationStart(url, epoch, tabId);
      harness = new PageHarness(harnessOptions ?? { url });
    },
    reload() {
      const url = harness.currentUrl;
      epoch += 1;
      mediaDetectionEngine.onNavigationStart(url, epoch, tabId);
      harness = new PageHarness({ url });
    },
    get epoch() {
      return epoch;
    },
    chromeSpaSync(url) {
      mediaDetectionEngine.onNavigationStart(url, epoch, tabId);
    },
    observeNativeRequest(input) {
      mediaDetectionEngine.observeNativeCandidate({
        tabId,
        navigationEpoch: input.epochOverride ?? epoch,
        observedAt: Date.now(),
        frameUrl: input.frameUrl ?? null,
        url: input.url,
        mimeType: input.mimeType ?? null,
        pageUrl:
          input.pageUrlOverride ?? useMediaDetectionStore.getState().lastNavigation ?? undefined,
        isForMainFrame: false,
        observationSource: 'webview',
      });
    },
    mseResolution(hasWholeSourceCandidate) {
      return classifyMsePlayback({
        state: getMsePlaybackState(tabId),
        hasWholeSourceCandidate: hasWholeSourceCandidate ?? rig.candidates().length > 0,
      });
    },
    mseState() {
      return getMsePlaybackState(tabId);
    },
    candidates() {
      const store = useMediaDetectionStore.getState();
      const mse = getMsePlaybackContext(store.lastNavigation);
      return filterCorrelatedCandidates(store.detectedMedia, {
        pageUrl: store.lastNavigation,
        msePlaybackActive: mse.msePlaybackActive,
        msePlaybackAgeMs: mse.msePlaybackAgeMs,
      });
    },
    selected() {
      const store = useMediaDetectionStore.getState();
      const mse = getMsePlaybackContext(store.lastNavigation);
      return selectDiscoveryMedia({
        candidates: rig.candidates(),
        focusedMediaId: null,
        lastNavigation: store.lastNavigation,
        activeTabId: tabId,
        navigationEpoch: store.navigationEpoch,
        ownershipKey: buildOwnershipKey(tabId),
        msePlaybackActive: mse.msePlaybackActive,
        msePlaybackAgeMs: mse.msePlaybackAgeMs,
      });
    },
    async offer() {
      const store = useMediaDetectionStore.getState();
      const pageUrlNow = store.lastNavigation;
      const media = rig.selected();
      // Same order as useBrowserMediaAction: what the blob/MSE player amounts to is decided before
      // anything is verified, so a protected player can never borrow an unrelated HTTP(S) candidate.
      const resolution = classifyMsePlayback({
        state: getMsePlaybackState(tabId),
        hasWholeSourceCandidate: media != null && !media.url.toLowerCase().startsWith('blob:'),
      });
      if (resolution.kind === 'PROTECTED') {
        return { ok: false as const, reason: resolution.reason };
      }
      if (!media || !pageUrlNow) {
        return {
          ok: false as const,
          reason: resolution.kind === 'UNSUPPORTED' ? resolution.reason : 'NO_CURRENT_MEDIA',
        };
      }
      const picked = selectCurrentMediaForActiveGeneralTab({
        candidates: rig.candidates(),
        tabId,
        navigationEpoch: store.navigationEpoch,
        pageUrl: pageUrlNow,
      });
      const context = generalPageMediaContextStore.get(tabId);
      if (!context) {
        return { ok: false as const, reason: 'NO_PAGE_CONTEXT' };
      }
      const result = await buildVerifiedGeneralMediaOffer({
        scope: {
          tabId,
          navigationEpoch: store.navigationEpoch,
          pageGeneration: context.pageGeneration,
          mediaIdentity: picked.group.currentMediaIdentity ?? context.currentMediaIdentity ?? '',
          ownershipConfidence: picked.group.confidence,
        },
        candidates: rig.candidates(),
        pageUrl: pageUrlNow,
        activeCandidateIds: picked.group.activeCandidateIds,
        // Same as useBrowserMediaAction: the ownership pass chose this one, so its variants win.
        ownedResourceUrl: media.finalUrl || media.url || null,
      });
      if (!result.ok) {
        return { ok: false as const, reason: result.reason };
      }
      const preferred =
        result.offer.variants.find((v) => v.variantId === result.offer.preferredVariantId) ??
        result.offer.variants.find((v) => v.downloadable);
      return { ok: true as const, offer: result.offer, url: preferred?.executableUrl ?? '' };
    },
  };

  return rig;
}
