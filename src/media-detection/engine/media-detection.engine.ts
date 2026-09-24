import { observeRequestUrl, parseMediaBridgeMessage } from '../adapters';
import type { ParsedBridgeMessage } from '../adapters/webview-bridge.adapter';
import {
  setNativeCandidateHandler,
  startNativeNetworkObservation,
  stopNativeNetworkObservation,
} from '../adapters/native-network.adapter';
import { DETECTION_TIMING } from '../constants';
import { describePlatformPage } from '../platform';
import {
  mediaDetectionPipeline,
  notifyBrowserDetectionSync,
  resolvePageUrl,
  isShareOrShortLink,
  logMediaDiagnostic,
  type PipelineResult,
} from '../services';
import {
  clearMsePlayback,
  clearMsePlaybackForTab,
  getMsePlaybackState,
  markMsePlayback,
  recordMseSourceObservation,
  setMseActiveTab,
  type MseSourceKind,
} from './mse-playback-context';
import { useMediaDetectionStore } from '../stores';
import type {
  BridgeActiveIframePlayerPayload,
  BridgeActiveVideoPayload,
  BridgeBlobIndicatorPayload,
  BridgeMediaCandidatePayload,
  BridgeMutationBatchPayload,
  BridgePageMetaPayload,
  DetectedMedia,
  MediaDetectionState,
  MediaObservationStamp,
} from '../types';
import { createDebounced, isSameDocumentUrl } from '../utils';
import { logIgRuntime } from '../services/ig-runtime-diagnostics.service';
import {
  resolveSocialPlatform,
  socialPageContextStore,
  shouldClearDetectionsOnSocialBump,
} from '../social';
import type { ActiveVideoEvidence } from '../social';
import { generalPageMediaContextStore } from '../general-media';
import { extractGeneralPageVideoId } from '../general-media/general-content-identity';
import { isSameGeneralContentNavigation } from '../general-media/general-content-navigation';
import { isInitOrFragmentMediaPath } from '../general-media/general-network-resource';
import { isLikelyMediaSegment } from '../services/false-positive.filter';
import { logGeneralNetworkTrace, logGeneralOwnerTrace, requestFrameClass } from '../general-media/general-media-diagnostics';

/**
 * Media Detection Engine — passive observer of browser activity.
 * Never interrupts navigation. Never downloads. Never shows UI.
 */
class MediaDetectionEngine {
  private started = false;
  private pageUrl: string | null = null;
  private navigationEpoch = 0;
  /** Owning tab for the active WebView observation stream. */
  private activeTabId: string | null = null;
  /**
   * The tab whose page the engine last started detecting. Kept apart from [activeTabId], which other hooks move
   * as soon as the tab changes — before the navigation for it arrives here — so a tab switch still reads as one.
   */
  private navigationTabId: string | null = null;
  /** When false, high-frequency bridge work is deferred (app backgrounded). */
  private appActive = true;
  /** When false, the Browser route is not on screen (another tab is focused). */
  private browserVisible = true;
  /** Skip identical active-video payloads before ownership work. */
  private lastActiveVideoKey = '';
  /**
   * The page this tab left for another document. Until the next document reports, the departed one is still alive
   * (the WebView commits the next page only when it arrives) and keeps posting; a message carrying its URL is that
   * page talking, not an SPA route back to it, and adopting it would discard what the next page already produced
   * and bring the departed video back.
   */
  private departedPageUrl: string | null = null;
  /**
   * The name an SPA route got after the route change was reported. Media the page reported before that (it batches
   * its reports) still carry the previous route's title and take this one when they arrive.
   */
  private routeTitleRename: { pageUrl: string; from: string; to: string } | null = null;
  /** Detections of tabs the user switched away from; restored when that same page is back in front. */
  private readonly tabSnapshots = new Map<string, TabDetectionSnapshot>();
  /**
   * Observations that arrived before the navigation they belong to reached the engine. WebView page messages,
   * native request events and the browser's navigation state travel on different queues, and the page's detector
   * reports each candidate exactly once, so an observation dropped in that window was lost for the life of the page.
   */
  private deferred: DeferredObservation[] = [];
  /** Asks the page shown in a tab to post everything it currently sees again (the browser injects the request). */
  private rescanRequester: ((tabId: string) => void) | null = null;
  /** A mutation batch was skipped while the Browser was hidden or the app inactive. */
  private droppedWhilePaused = false;
  private readonly debouncedRescanNotify = createDebounced(() => {
    notifyBrowserDetectionSync();
  }, DETECTION_TIMING.rescanDebounceMs);

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    mediaDetectionPipeline.reset();
    setNativeCandidateHandler((candidate) => {
      this.observeNativeCandidate(candidate);
    });
    startNativeNetworkObservation();
  }

  stop(): void {
    this.started = false;
    this.pageUrl = null;
    this.appActive = true;
    this.browserVisible = true;
    this.activeTabId = null;
    this.navigationTabId = null;
    this.lastActiveVideoKey = '';
    this.departedPageUrl = null;
    this.routeTitleRename = null;
    this.tabSnapshots.clear();
    this.deferred = [];
    this.droppedWhilePaused = false;
    this.debouncedRescanNotify.cancel();
    stopNativeNetworkObservation();
    setNativeCandidateHandler(null);
    mediaDetectionPipeline.reset();
    socialPageContextStore.clearAll();
    generalPageMediaContextStore.clearAll();
    clearMsePlayback();
  }

  /**
   * Bind observation stream to the active browser tab (Phase 4A / 5A ownership).
   */
  setActiveTab(tabId: string | null): void {
    this.activeTabId = tabId;
    socialPageContextStore.setActiveTab(tabId);
    generalPageMediaContextStore.setActiveTab(tabId);
    setMseActiveTab(tabId);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  clearTab(tabId: string): void {
    this.tabSnapshots.delete(tabId);
    socialPageContextStore.clearTab(tabId);
    generalPageMediaContextStore.clearTab(tabId);
    clearMsePlaybackForTab(tabId);
  }

  /**
   * Background/foreground — preserve detections; skip mutation thrash while inactive.
   */
  setAppActive(active: boolean): void {
    this.appActive = active;
    this.applyWorkGate();
  }

  /**
   * Browser route focus. A parked WebView keeps streaming DOM mutation batches
   * while the user is on Downloads / Player; processing them there is pure JS
   * thread contention. Detections and network candidates are untouched — only
   * the high-frequency rescan path pauses.
   */
  setBrowserVisible(visible: boolean): void {
    this.browserVisible = visible;
    this.applyWorkGate();
  }

  private isHighFrequencyWorkAllowed(): boolean {
    return this.appActive && this.browserVisible;
  }

  private applyWorkGate(): void {
    if (this.isHighFrequencyWorkAllowed()) {
      this.debouncedRescanNotify();
      // Candidates the page posted while the Browser was hidden were skipped, and the page reports each one only
      // once: have it announce what it shows now.
      if (this.droppedWhilePaused) {
        this.droppedWhilePaused = false;
        this.requestRescan();
      }
    } else {
      this.debouncedRescanNotify.cancel();
    }
  }

  /** Installed by the browser: makes the page in `tabId` re-announce its media (see the injected detector). */
  setRescanRequester(requester: ((tabId: string) => void) | null): void {
    this.rescanRequester = requester;
  }

  private requestRescan(): void {
    const tabId = this.activeTabId;
    if (!tabId || !this.pageUrl || !this.rescanRequester) {
      return;
    }
    try {
      this.rescanRequester(tabId);
    } catch {
      // A tab without a live WebView simply has nothing to rescan.
    }
  }

  /**
   * Called when browser navigation commits a new document URL.
   */
  onNavigationStart(url: string, epoch?: number, tabId?: string | null): void {
    if (!this.started) {
      this.start();
    }

    const previousTabId = this.navigationTabId;
    const previousEpoch = this.navigationEpoch;
    const previousPageUrl = this.pageUrl;
    const tabChanged = Boolean(tabId) && tabId !== previousTabId;
    if (tabId) {
      this.setActiveTab(tabId);
      this.navigationTabId = tabId;
    }

    this.navigationEpoch =
      typeof epoch === 'number' && Number.isFinite(epoch)
        ? epoch
        : this.navigationEpoch + 1;

    const store = useMediaDetectionStore.getState();

    // Same tab, same navigation and the same page content — a hash, tracking or share parameters, a trailing slash,
    // or a route the page already reported: the running detection stays. Anything else is a new page for the user:
    // another tab, a reload or a load of the same URL (a new document, whose detector reports everything again), or
    // other content (`watch.php?id=2` after `?id=1`).
    if (
      !tabChanged &&
      this.navigationEpoch === previousEpoch &&
      previousPageUrl &&
      isSamePageContent(url, previousPageUrl)
    ) {
      this.pageUrl = url;
      store.setLastNavigation(url, this.navigationEpoch);
      store.setScanning(true, Math.max(store.scanProgress, 0.3));
      this.syncSocialContext(url);
      this.syncGeneralMediaContext(url);
      this.replayDeferred();
      return;
    }

    if (tabChanged && previousTabId && previousPageUrl) {
      this.snapshotTab(previousTabId, previousPageUrl, previousEpoch);
    }

    // From the start page, the page left before it is the one that may still be posting.
    const leftPageUrl = previousPageUrl ?? this.departedPageUrl;
    this.departedPageUrl =
      !tabChanged && leftPageUrl && !isSamePageContent(url, leftPageUrl) ? leftPageUrl : null;
    this.pageUrl = url;
    store.clearPageDetections();
    store.setLastNavigation(url, this.navigationEpoch);
    store.setScanning(true, 0.1);
    store.setDetectionError(null);
    mediaDetectionPipeline.reset();
    if (!tabChanged) {
      // Blob/MSE evidence is kept per tab: only the page that is replaced loses it.
      clearMsePlaybackForTab(this.activeTabId);
    } else if (tabId) {
      // Back to a tab: its evidence stays only while it still describes the page and navigation that tab shows.
      const mse = getMsePlaybackState(tabId);
      if (mse && (mse.navigationEpoch !== this.navigationEpoch || !isSamePageContent(mse.pageUrl, url))) {
        clearMsePlaybackForTab(tabId);
      }
    }
    this.lastActiveVideoKey = '';
    this.syncSocialContext(url);
    this.syncGeneralMediaContext(url);

    if (tabChanged && tabId) {
      // Back to a tab: what it had found is still valid when it still shows the same page; its page also posts what
      // it sees again, since its reports went to the tab that was in front meanwhile.
      this.restoreTab(tabId, url, this.navigationEpoch);
      this.requestRescan();
    }
    this.replayDeferred();

    const platform = describePlatformPage(url);
    logMediaDiagnostic('input', {
      url,
      navigationEpoch: this.navigationEpoch,
      platform: platform.kind,
      isPublicContentPath: platform.isPublicContentPath,
    });

    if (isShareOrShortLink(url)) {
      const epoch = this.navigationEpoch;
      void resolvePageUrl(url).then((resolved) => {
        if (!this.isCurrentEpoch(epoch)) {
          return;
        }
        if (resolved.ok && resolved.resolvedPageUrl !== url) {
          this.pageUrl = resolved.resolvedPageUrl;
          store.setLastNavigation(resolved.resolvedPageUrl, epoch);
          this.syncSocialContext(resolved.resolvedPageUrl);
          this.syncGeneralMediaContext(resolved.resolvedPageUrl);
        }
      });
    }
  }

  private snapshotTab(tabId: string, pageUrl: string, navigationEpoch: number): void {
    const store = useMediaDetectionStore.getState();
    this.tabSnapshots.delete(tabId);
    if (store.detectedMedia.length === 0) {
      return;
    }
    this.tabSnapshots.set(tabId, {
      pageUrl,
      navigationEpoch,
      detectedMedia: store.detectedMedia,
      qualities: store.qualities,
      pageMetadata: store.pageMetadata,
    });
    while (this.tabSnapshots.size > MAX_TAB_SNAPSHOTS) {
      const oldest = this.tabSnapshots.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.tabSnapshots.delete(oldest);
    }
  }

  private restoreTab(tabId: string, pageUrl: string, navigationEpoch: number): void {
    const snapshot = this.tabSnapshots.get(tabId);
    this.tabSnapshots.delete(tabId);
    if (
      !snapshot ||
      snapshot.navigationEpoch !== navigationEpoch ||
      !isSamePageContent(snapshot.pageUrl, pageUrl)
    ) {
      return;
    }
    const store = useMediaDetectionStore.getState();
    useMediaDetectionStore.setState({
      detectedMedia: snapshot.detectedMedia,
      qualities: snapshot.qualities,
      pageMetadata: snapshot.pageMetadata,
      lastScan: Date.now(),
    });
    store.recomputeDerived();
  }

  /** Keeps an observation that is ahead of the engine's navigation; replayed once the navigation arrives. */
  private defer(observation: DeferredEntry): void {
    const now = Date.now();
    this.deferred = this.deferred.filter((entry) => now - entry.at < DEFERRED_TTL_MS);
    this.deferred.push({ ...observation, at: now });
    if (this.deferred.length > MAX_DEFERRED) {
      this.deferred.splice(0, this.deferred.length - MAX_DEFERRED);
    }
  }

  private replayDeferred(): void {
    if (this.deferred.length === 0) {
      return;
    }
    const now = Date.now();
    const pending = this.deferred.filter((entry) => now - entry.at < DEFERRED_TTL_MS);
    this.deferred = [];
    for (const entry of pending) {
      if (entry.kind === 'native') {
        this.observeNativeCandidate(entry.native, { replay: true });
      } else {
        this.handleWebViewMessage(entry.raw, { replay: true });
      }
    }
  }

  onNavigationComplete(url: string): void {
    if (!this.pageUrl) {
      return;
    }
    const store = useMediaDetectionStore.getState();
    this.pageUrl = url;
    store.setLastNavigation(url, this.navigationEpoch);
    store.setScanning(true, 0.5);
  }

  /** `tabId`: the tab now showing the start page (a new tab opens there). */
  onGoHome(tabId?: string | null): void {
    const store = useMediaDetectionStore.getState();
    const homeTabId = tabId ?? this.activeTabId;
    // Another tab opened on its start page: what the previous tab found is kept for when it comes back.
    if (homeTabId && this.navigationTabId && homeTabId !== this.navigationTabId && this.pageUrl) {
      this.snapshotTab(this.navigationTabId, this.pageUrl, this.navigationEpoch);
    }
    // The page left for the start page in this tab can still post while the next page loads.
    this.departedPageUrl =
      homeTabId && homeTabId === this.navigationTabId ? (this.pageUrl ?? this.departedPageUrl) : null;
    if (homeTabId) {
      this.navigationTabId = homeTabId;
    }
    this.deferred = [];
    this.pageUrl = null;
    this.navigationEpoch += 1;
    this.lastActiveVideoKey = '';
    store.clearPageDetections();
    store.setLastNavigation(null, this.navigationEpoch);
    store.setScanning(false, 0);
    mediaDetectionPipeline.reset();
    clearMsePlaybackForTab(homeTabId);
    if (homeTabId) {
      socialPageContextStore.clearTab(homeTabId);
      generalPageMediaContextStore.clearTab(homeTabId);
    }
  }

  /**
   * Browser main-frame error — invalidate current page media CTA context.
   */
  onBrowserError(): void {
    const store = useMediaDetectionStore.getState();
    this.deferred = [];
    store.clearPageDetections();
    store.setScanning(false, 0);
    mediaDetectionPipeline.reset();
    clearMsePlaybackForTab(this.activeTabId);
    if (this.activeTabId) {
      socialPageContextStore.clearTab(this.activeTabId);
      generalPageMediaContextStore.clearTab(this.activeTabId);
    }
  }

  /**
   * Passive network URL observation (does not affect allow/deny).
   */
  observeUrl(url: string, pageUrl?: string): void {
    if (!this.started || !this.pageUrl) {
      return;
    }

    const effectivePage = pageUrl ?? this.pageUrl;
    if (!isSameDocumentUrl(effectivePage, this.pageUrl)) {
      return;
    }

    if (mediaDetectionPipeline.isSegmentBlocked(url)) {
      return;
    }

    const observed = observeRequestUrl(url, effectivePage);
    if (!observed) {
      // Still try MIME probe path for extensionless navigations that look media-ish.
      const epoch = this.navigationEpoch;
      void this.maybeProbeUrls([url], effectivePage, epoch);
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    const result = mediaDetectionPipeline.processNetworkUrl(
      store.detectedMedia,
      observed.url,
      observed.pageUrl,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    void this.afterIngest(result, epoch);
  }

  observeNativeCandidate(input: NativeObservationInput, options?: { replay?: boolean }): void {
    if (!this.started || !this.pageUrl) {
      return;
    }
    // A request of the active tab's next navigation can arrive before that navigation reaches the engine (the
    // WebView's request events and its navigation events travel on different queues): keep it until it does.
    if (
      !options?.replay &&
      input.tabId != null &&
      input.tabId === this.activeTabId &&
      typeof input.navigationEpoch === 'number' &&
      input.navigationEpoch > this.navigationEpoch
    ) {
      this.defer({ kind: 'native', native: input });
      return;
    }
    // Never attribute process-global or parked WebView traffic to the active tab.
    if (input.tabId !== this.activeTabId || input.navigationEpoch !== this.navigationEpoch) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        candidateFingerprintHash: input.resourceFingerprint ?? null,
        frameClass: requestFrameClass(input.isForMainFrame),
        observationSource: input.observationSource ?? 'webview',
        acceptedIntoIngest: false,
        navigationEpoch: input.navigationEpoch ?? null,
        engineNavigationEpoch: this.navigationEpoch,
        rejectionReason: !input.tabId
          ? input.observationSource === 'service-worker'
            ? 'AMBIGUOUS_WORKER_OWNER'
            : 'NO_CURRENT_OWNER'
          : input.tabId !== this.activeTabId
            ? 'STALE_TAB'
            : 'STALE_GENERATION',
      });
      return;
    }
    const effectivePage = input.pageUrl ?? this.pageUrl;
    const social = resolveSocialPlatform(this.pageUrl);
    const pageMatches = social
      ? isSameDocumentUrl(effectivePage, this.pageUrl)
      : isSameDocumentUrl(effectivePage, this.pageUrl) ||
        isSameGeneralContentNavigation(effectivePage, this.pageUrl);
    if (!pageMatches) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        frameClass: requestFrameClass(input.isForMainFrame),
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'page_mismatch',
      });
      // Scoped to the page this tab is loading next (the scope moves with the WebView's load start, the engine with
      // the browser state): replayed when the engine reaches that page, dropped after a few seconds otherwise.
      if (!options?.replay) {
        this.defer({ kind: 'native', native: input });
      }
      return;
    }
    // A request the departed document made while the next one was loading: the WebView's scope already names the
    // next page, but a same-origin Referer still names the page that asked.
    if (this.departedPageUrl && input.frameUrl && isSamePageContent(input.frameUrl, this.departedPageUrl)) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        candidateFingerprintHash: input.resourceFingerprint ?? null,
        frameClass: requestFrameClass(input.isForMainFrame),
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'departed_document',
      });
      return;
    }
    // A blob/MSE player is explained by the traffic it produces: repeated init/fragment requests mean
    // there is no single downloadable file, a whole-file request means the ordinary pipeline can take
    // over. Recorded before the segment blocklist drops the URL, which is where that evidence is lost.
    if (this.activeTabId) {
      recordMseSourceObservation({
        tabId: this.activeTabId,
        navigationEpoch: this.navigationEpoch,
        kind: isSegmentOrFragmentUrl(input.url) ? 'segment' : 'whole',
      });
    }
    if (mediaDetectionPipeline.isSegmentBlocked(input.url)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    // Stamped before dedupe: a resource already on record (rotated signed URL, or the same URL after a reload)
    // moves to the scope it was just observed in, including when it only lands after a MIME probe.
    const observation: MediaObservationStamp = {
      frameUrl: input.frameUrl ?? null,
      observedTabId: input.tabId,
      observedNavigationEpoch: input.navigationEpoch,
      observedPageGeneration: this.activeTabId ? generalPageMediaContextStore.get(this.activeTabId)?.pageGeneration : undefined,
    };
    const result = mediaDetectionPipeline.processNetworkUrl(
      store.detectedMedia,
      input.url,
      effectivePage,
      store.qualities,
      {
        mimeType: input.mimeType,
        detectionSource: 'native_network',
        requiresCookies: input.requiresCookies,
        hasRange: input.hasRange,
        isForMainFrame: input.isForMainFrame,
        observation,
      },
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    const beforeCount = store.detectedMedia.length;
    this.applyPipelineResult(result);
    if (result.media.length > beforeCount) {
      logIgRuntime('network_candidate', {
        hostname: safeHostname(input.url),
        source: 'native_network',
        mimeType: input.mimeType ?? null,
      });
      logGeneralNetworkTrace('CANDIDATE_INGESTED', {
        tabId: this.activeTabId,
        frameClass: requestFrameClass(input.isForMainFrame),
        hasRange: Boolean(input.hasRange),
        mimeHintClass: input.mimeType ? 'present' : 'none',
        acceptedIntoIngest: true,
        candidateFingerprintHash: input.resourceFingerprint ?? null,
        observationSource: input.observationSource ?? 'webview',
      });
    } else if (result.pendingProbeUrls.length > 0) {
      logGeneralNetworkTrace('RESOURCE_CLASSIFIED', {
        tabId: this.activeTabId,
        frameClass: requestFrameClass(input.isForMainFrame),
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'probe_pending',
      });
    } else if (result.rejected > 0) {
      logGeneralNetworkTrace('RESOURCE_REJECTED', {
        tabId: this.activeTabId,
        frameClass: requestFrameClass(input.isForMainFrame),
        hasRange: Boolean(input.hasRange),
        acceptedIntoIngest: false,
        rejectionReason: 'parser_rejected',
      });
    }
    void this.afterIngest(result, epoch, observation);
  }

  handleWebViewMessage(raw: string, options?: { replay?: boolean }): void {
    if (!this.started || !this.pageUrl) {
      return;
    }

    const message = parseMediaBridgeMessage(raw);
    if (!message) {
      return;
    }

    // A message from a page the engine has not navigated to yet (another origin, so not an SPA route it could
    // adopt): the browser's navigation for it is still on its way. The page reports each candidate once, so keep it.
    const messagePageUrl = pageUrlOfMessage(message);
    if (
      !options?.replay &&
      messagePageUrl &&
      !isSamePageContent(messagePageUrl, this.pageUrl) &&
      !isSameOrigin(messagePageUrl, this.pageUrl) &&
      !resolveSocialPlatform(messagePageUrl)
    ) {
      this.defer({ kind: 'page', raw });
      return;
    }

    switch (message.type) {
      case 'ready':
        useMediaDetectionStore.getState().setScanning(true, 0.3);
        break;
      case 'page_meta':
        this.handlePageMeta(message.payload);
        break;
      case 'media_candidate':
        this.handleCandidate(message.payload);
        break;
      case 'mutation_batch':
        if (!this.isHighFrequencyWorkAllowed()) {
          this.droppedWhilePaused = true;
          break;
        }
        this.handleBatch(message.payload);
        break;
      case 'blob_indicator':
        this.handleBlobIndicator(message.payload);
        break;
      case 'active_video':
        this.handleActiveVideo(message.payload);
        break;
      case 'active_iframe_player':
        this.handleActiveIframePlayer(message.payload);
        break;
      case 'scan_complete':
        useMediaDetectionStore.getState().setScanning(false, 1);
        this.debouncedRescanNotify();
        break;
      case 'error':
        useMediaDetectionStore.getState().setDetectionError({
          code: 'detection_failure',
          message: message.payload.message || 'Detection error',
          url: this.pageUrl,
          occurredAt: Date.now(),
        });
        break;
      default:
        break;
    }
  }

  private handlePageMeta(payload: BridgePageMetaPayload): void {
    // page_meta carries the page's own location.href and is the first thing the detector re-posts after a
    // history transition, so it is the earliest authoritative notice of an SPA route change — well before
    // the WebView reports one to the browser chrome.
    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }
    this.syncSocialContext(payload.pageUrl);
    this.syncGeneralMediaContext(payload.pageUrl);

    const meta = mediaDetectionPipeline.processPageMeta(payload);
    if (meta) {
      const store = useMediaDetectionStore.getState();
      const previous = store.pageMetadata;
      // An SPA names its route after the route change was reported: what was named after the previous route's
      // title (read while pushState ran) takes the page's own name now.
      if (
        previous?.title &&
        meta.title &&
        previous.title !== meta.title &&
        isSameDocumentUrl(previous.pageUrl, meta.pageUrl)
      ) {
        this.routeTitleRename = { pageUrl: meta.pageUrl, from: previous.title, to: meta.title };
        store.renamePageMedia(meta.pageUrl, previous.title, meta.title);
      }
      store.setPageMetadata(meta);

      if (meta.ogVideo) {
        this.observeUrl(meta.ogVideo, meta.pageUrl);
      }
    }
  }

  /**
   * A blob: sighting. The URL itself is never a candidate and never reaches the store — it is recorded
   * as evidence that a player is running whose real HTTP(S) source has to be correlated from network
   * observation, together with whatever protection evidence the page could see.
   */
  private handleBlobIndicator(payload: BridgeBlobIndicatorPayload): void {
    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }
    this.markPlayerMseEvidence({
      pageUrl: payload.pageUrl,
      elementIdentity: payload.elementIdentity,
      sourceKind: payload.sourceKind,
      isProtected: payload.isProtected,
    });
    logMediaDiagnostic('page_load', {
      pageUrl: payload.pageUrl,
      mseBlob: true,
      videoPlay: true,
    });
    logIgRuntime('playback', { mseBlob: true, logger: 'shared' });
  }

  /** Scope blob/MSE evidence to the owning tab, navigation epoch and page generation. */
  private markPlayerMseEvidence(input: {
    pageUrl: string;
    elementIdentity: string | null;
    sourceKind: MseSourceKind | null;
    isProtected: boolean;
  }): void {
    if (!this.activeTabId || !this.pageUrl) {
      return;
    }
    const state = markMsePlayback({
      tabId: this.activeTabId,
      navigationEpoch: this.navigationEpoch,
      pageGeneration: generalPageMediaContextStore.get(this.activeTabId)?.pageGeneration ?? null,
      pageUrl: input.pageUrl || this.pageUrl,
      elementIdentity: input.elementIdentity,
      sourceKind: input.sourceKind,
      isProtected: input.isProtected,
    });
    logGeneralOwnerTrace('GENERAL_PLAYER_DISCOVERED', {
      tabId: state.tabId,
      pageGeneration: state.pageGeneration,
      playerKind: 'video',
      identityKind: state.sourceKind === 'mse' ? 'mse-player' : 'blob-player',
      reason: state.protection === 'PROTECTED' ? 'PROTECTED' : null,
    });
    // Protection changes what may be offered, so selection and verification must re-run for it.
    this.debouncedRescanNotify();
  }

  private handleActiveVideo(payload: BridgeActiveVideoPayload): void {
    const videoKey = [
      payload.pageUrl,
      payload.elementIdentity,
      payload.currentSrc ?? '',
      payload.src ?? '',
      String(payload.paused),
      String(payload.recentlyPlayed),
      payload.associatedContentId ?? '',
      String(payload.intersectionRatio),
      String(payload.isDisplayed),
      String(payload.isVisibleStyle),
      String(payload.explicitAdMarker),
      String(payload.videoWidth), String(payload.videoHeight),
      // Protection appearing on a player already on record must never be deduped away.
      String(payload.isProtected),
    ].join('|');
    if (videoKey === this.lastActiveVideoKey) {
      return;
    }
    this.lastActiveVideoKey = videoKey;

    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }
    if (!this.activeTabId) {
      return;
    }

    const evidence: ActiveVideoEvidence = {
      pageUrl: payload.pageUrl,
      elementIdentity: payload.elementIdentity,
      currentSrc: payload.currentSrc,
      src: payload.src,
      isBlob: payload.isBlob,
      paused: payload.paused,
      ended: payload.ended,
      readyState: payload.readyState,
      videoWidth: payload.videoWidth,
      videoHeight: payload.videoHeight,
      muted: payload.muted,
      currentTimeBucket: payload.currentTimeBucket,
      intersectionRatio: payload.intersectionRatio,
      viewportCenterDistance: payload.viewportCenterDistance,
      isDisplayed: payload.isDisplayed,
      isVisibleStyle: payload.isVisibleStyle,
      recentlyPlayed: payload.recentlyPlayed,
      explicitAdMarker: payload.explicitAdMarker,
      associatedContentId: payload.associatedContentId,
      observedAt: Date.now(),
    };

    if (payload.isBlob && this.pageUrl) {
      this.markPlayerMseEvidence({
        pageUrl: payload.pageUrl,
        elementIdentity: payload.elementIdentity,
        sourceKind: payload.sourceKind,
        isProtected: payload.isProtected,
      });
    } else if (payload.isProtected && this.pageUrl) {
      // A protected player with a plain src is still protected; record it so nothing is offered for it.
      this.markPlayerMseEvidence({
        pageUrl: payload.pageUrl,
        elementIdentity: payload.elementIdentity,
        sourceKind: null,
        isProtected: true,
      });
    }

    if (resolveSocialPlatform(payload.pageUrl)) {
      const beforeGen =
        socialPageContextStore.get(this.activeTabId)?.contextGeneration ?? 0;
      const beforeIdentity =
        socialPageContextStore.get(this.activeTabId)?.currentVisibleMediaIdentity ??
        null;
      socialPageContextStore.applyActiveVideoEvidence({
        tabId: this.activeTabId,
        navigationEpoch: this.navigationEpoch,
        evidence,
      });
      const after = socialPageContextStore.get(this.activeTabId);
      const afterGen = after?.contextGeneration ?? 0;
      const afterIdentity = after?.currentVisibleMediaIdentity ?? null;
      const beforeWasCanonical = Boolean(
        beforeIdentity && !beforeIdentity.includes(':ephemeral:'),
      );
      const ownershipChanged =
        afterGen > beforeGen ||
        Boolean(beforeIdentity && afterIdentity && beforeIdentity !== afterIdentity);
      const bumpKind =
        !ownershipChanged
          ? 'none'
          : !beforeWasCanonical && Boolean(after?.canonicalContentId)
            ? 'identity_upgrade'
            : 'ownership_change';
      if (shouldClearDetectionsOnSocialBump({ bumpKind })) {
        useMediaDetectionStore.getState().clearPageDetections();
        mediaDetectionPipeline.reset();
      }
    } else {
      // Ensure general context exists before applying evidence (first observation).
      if (!generalPageMediaContextStore.get(this.activeTabId) && this.pageUrl) {
        generalPageMediaContextStore.syncFromPageUrl({
          tabId: this.activeTabId,
          pageUrl: this.pageUrl,
          navigationEpoch: this.navigationEpoch,
        });
      }
      generalPageMediaContextStore.applyActiveVideoEvidence({
        tabId: this.activeTabId,
        navigationEpoch: this.navigationEpoch,
        evidence,
      });
    }
    this.debouncedRescanNotify();
  }

  private handleActiveIframePlayer(payload: BridgeActiveIframePlayerPayload): void {
    if (!this.activeTabId || !this.pageUrl) {
      return;
    }
    if (resolveSocialPlatform(this.pageUrl) || resolveSocialPlatform(payload.pageUrl)) {
      return;
    }
    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }

    if (!generalPageMediaContextStore.get(this.activeTabId)) {
      generalPageMediaContextStore.syncFromPageUrl({
        tabId: this.activeTabId,
        pageUrl: this.pageUrl,
        navigationEpoch: this.navigationEpoch,
      });
    }

    const associated =
      payload.associatedContentId ??
      extractGeneralPageVideoId(payload.pageUrl) ??
      extractGeneralPageVideoId(this.pageUrl);

    generalPageMediaContextStore.applyActiveIframePlayerEvidence({
      tabId: this.activeTabId,
      navigationEpoch: this.navigationEpoch,
      evidence: {
        pageUrl: payload.pageUrl || this.pageUrl,
        iframeIdentity: payload.iframeIdentity,
        iframeSrc: payload.iframeSrc,
        frameClass: payload.frameClass,
        isDisplayed: payload.isDisplayed,
        isVisibleStyle: payload.isVisibleStyle,
        intersectionRatio: payload.intersectionRatio,
        width: payload.width,
        height: payload.height,
        allowFullscreen: payload.allowFullscreen,
        allow: payload.allow,
        looksPlayer: payload.looksPlayer,
        sameOriginVideoCount: payload.sameOriginVideoCount,
        associatedContentId: associated,
        observedAt: Date.now(),
      },
    });
    this.debouncedRescanNotify();
  }

  private syncSocialContext(pageUrl: string): void {
    if (!this.activeTabId) {
      return;
    }
    if (!resolveSocialPlatform(pageUrl)) {
      socialPageContextStore.clearTab(this.activeTabId);
      return;
    }
    socialPageContextStore.syncFromPageUrl({
      tabId: this.activeTabId,
      pageUrl,
      navigationEpoch: this.navigationEpoch,
    });
  }

  private syncGeneralMediaContext(pageUrl: string): void {
    if (!this.activeTabId) {
      return;
    }
    if (resolveSocialPlatform(pageUrl)) {
      generalPageMediaContextStore.clearTab(this.activeTabId);
      return;
    }
    generalPageMediaContextStore.syncFromPageUrl({
      tabId: this.activeTabId,
      pageUrl,
      navigationEpoch: this.navigationEpoch,
    });
  }

  private handleCandidate(payload: BridgeMediaCandidatePayload): void {
    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    const result = mediaDetectionPipeline.processBridgeCandidate(
      store.detectedMedia,
      payload,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    void this.afterIngest(result, epoch);
  }

  private handleBatch(payload: BridgeMutationBatchPayload): void {
    if (!this.adoptObservationPageUrl(payload.pageUrl)) {
      return;
    }

    const epoch = this.navigationEpoch;
    const store = useMediaDetectionStore.getState();
    if (store.scanProgress < 1) {
      store.setScanning(true, Math.max(store.scanProgress, 0.7));
    }
    const result = mediaDetectionPipeline.processBridgeBatch(
      store.detectedMedia,
      payload,
      store.qualities,
    );
    if (!this.isCurrentEpoch(epoch)) {
      return;
    }
    this.applyPipelineResult(result);
    store.setScanning(false, 1);
    void this.afterIngest(result, epoch);
    this.debouncedRescanNotify();
  }

  /** A report made before the SPA route got its own name carries the previous route's title: it takes the new one. */
  private withRouteTitle(media: DetectedMedia): DetectedMedia {
    const rename = this.routeTitleRename;
    if (!rename || media.title !== rename.from || !isSameDocumentUrl(media.pageUrl, rename.pageUrl)) {
      return media;
    }
    return { ...media, title: rename.to };
  }

  private applyPipelineResult(result: PipelineResult): void {
    if (!this.pageUrl) {
      return;
    }

    const store = useMediaDetectionStore.getState();
    if (result.media !== store.detectedMedia) {
      result.media = result.media.map((media) => this.withRouteTitle(media));
      result.media = result.media.map((media) => media.observedTabId ? media : {
        ...media,
        observedTabId: this.activeTabId,
        observedNavigationEpoch: this.navigationEpoch,
        observedPageGeneration: this.activeTabId ? generalPageMediaContextStore.get(this.activeTabId)?.pageGeneration : undefined,
      });
    }
    const previousCount = store.detectedMedia.length;

    if (result.media !== store.detectedMedia) {
      useMediaDetectionStore.setState({
        detectedMedia: result.media,
        videoFormats: result.media.filter((m) => m.category === 'video'),
        audioFormats: result.media.filter((m) => m.category === 'audio'),
        streamFormats: result.media.filter((m) => m.category === 'stream'),
        confidence:
          result.media.length === 0
            ? 0
            : Number(
                (
                  result.media.reduce((s, m) => s + m.confidence, 0) /
                  result.media.length
                ).toFixed(3),
              ),
        lastScan: Date.now(),
        statistics: {
          ...store.statistics,
          totalDetected: result.media.length,
          videoCount: result.media.filter((m) => m.category === 'video').length,
          audioCount: result.media.filter((m) => m.category === 'audio').length,
          streamCount: result.media.filter((m) => m.category === 'stream').length,
          duplicateUpdates:
            store.statistics.duplicateUpdates + result.updated,
          rejectedCount: store.statistics.rejectedCount + result.rejected,
          lastScanDurationMs: result.durationMs,
          scansCompleted: store.statistics.scansCompleted + 1,
        },
      });
      if (result.media.length > previousCount) {
        const newest = result.media[result.media.length - 1];
        logIgRuntime('store_insert', {
          count: result.media.length,
          hostname: safeHostname(newest?.url ?? ''),
          mimeType: newest?.mimeType ?? null,
          confidence: newest?.confidence ?? null,
        });
      }
    } else if (result.rejected > 0) {
      store.bumpStatistics({
        rejectedCount: store.statistics.rejectedCount + result.rejected,
        lastScanDurationMs: result.durationMs,
      });
    }

    if (result.qualities.length) {
      store.upsertQualities(result.qualities);
    }
  }

  private async afterIngest(
    result: PipelineResult,
    epoch: number,
    observation?: MediaObservationStamp,
  ): Promise<void> {
    await this.maybeProbeUrls(result.pendingProbeUrls, this.pageUrl, epoch, observation);
    await this.maybeEnrichManifests(result, epoch);
  }

  private async maybeProbeUrls(
    urls: string[],
    pageUrl: string | null,
    epoch: number,
    observation?: MediaObservationStamp,
  ): Promise<void> {
    if (!pageUrl || !urls.length) {
      return;
    }
    const unique = Array.from(new Set(urls)).slice(0, 8);
    for (const url of unique) {
      try {
        if (
          !this.isCurrentEpoch(epoch) ||
          mediaDetectionPipeline.signal?.aborted
        ) {
          return;
        }
        const store = useMediaDetectionStore.getState();
        const probed = await mediaDetectionPipeline.enrichWithMimeProbe(
          url,
          pageUrl,
          store.detectedMedia,
          store.qualities,
          observation,
        );
        if (!probed || !this.isCurrentEpoch(epoch)) {
          continue;
        }
        this.applyPipelineResult(probed);
        await this.maybeEnrichManifests(probed, epoch);
      } catch {
        // Isolation
      }
    }
  }

  private async maybeEnrichManifests(
    result: PipelineResult,
    epoch: number,
  ): Promise<void> {
    const pageAtStart = this.pageUrl;
    if (!pageAtStart) {
      return;
    }

    const streams = result.media.filter((m) => {
      const kind = mediaDetectionPipeline.needsManifestEnrichment(m);
      return kind != null;
    });

    for (const stream of streams.slice(0, 3)) {
      try {
        const kind = mediaDetectionPipeline.needsManifestEnrichment(stream);
        const enriched =
          kind === 'dash'
            ? await mediaDetectionPipeline.enrichDashMedia(stream)
            : await mediaDetectionPipeline.enrichHlsMedia(stream);
        if (!enriched) {
          continue;
        }
        if (
          !this.isCurrentEpoch(epoch) ||
          !this.pageUrl ||
          !isSameDocumentUrl(pageAtStart, this.pageUrl) ||
          mediaDetectionPipeline.signal?.aborted
        ) {
          return;
        }
        if (!isSameDocumentUrl(enriched.media.pageUrl, this.pageUrl)) {
          continue;
        }

        useMediaDetectionStore.getState().upsertMedia(this.withRouteTitle(enriched.media));
        if (enriched.qualities.length) {
          useMediaDetectionStore.getState().upsertQualities(enriched.qualities);
        }
        if (enriched.media.isDrm) {
          useMediaDetectionStore.getState().setDetectionError({
            code: 'encrypted_hls',
            message:
              enriched.media.streamType === 'DASH'
                ? 'Encrypted DASH stream detected — download not supported.'
                : 'Encrypted HLS stream detected — download not supported.',
            url: enriched.media.url,
            occurredAt: Date.now(),
          });
        }
      } catch {
        // Isolation — enrichment failures must never crash browsing.
      }
    }
  }

  private acceptsPageUrl(pageUrl: string | null | undefined): boolean {
    if (!this.pageUrl || !pageUrl) {
      return false;
    }
    return isSameDocumentUrl(pageUrl, this.pageUrl);
  }

  /**
   * Whether an observation that says it came from `pageUrl` belongs to the page the engine is on —
   * adopting a same-origin SPA route (or a social content change) the page has already moved to.
   *
   * The page reports its route changes long before the WebView reports them to the browser chrome, and
   * the detector's own `seen` cache means a candidate is produced exactly once. Refusing an observation
   * because the chrome has not caught up therefore loses that media for the life of the page, so every
   * observation path — page_meta, mutation batches, single candidates and active-player evidence — goes
   * through this one rule rather than each guessing on its own.
   */
  private adoptObservationPageUrl(pageUrl: string): boolean {
    if (!this.pageUrl) {
      return false;
    }
    if (this.departedPageUrl && isSamePageContent(pageUrl, this.departedPageUrl)) {
      return false;
    }
    if (isSameDocumentUrl(pageUrl, this.pageUrl)) {
      // The next document is reporting: the departed page is gone.
      this.departedPageUrl = null;
      return true;
    }
    if (!this.activeTabId) {
      return false;
    }
    const social = resolveSocialPlatform(pageUrl);
    if (!social && !isSameOriginSpaTransition(this.pageUrl, pageUrl)) {
      return false;
    }
    this.departedPageUrl = null;

    const previousSocial = social ? socialPageContextStore.get(this.activeTabId) : null;
    const previousGeneral = social ? null : generalPageMediaContextStore.get(this.activeTabId);

    this.pageUrl = pageUrl;
    useMediaDetectionStore.getState().setLastNavigation(pageUrl, this.navigationEpoch);
    this.syncSocialContext(pageUrl);
    this.syncGeneralMediaContext(pageUrl);

    // A genuine content change discards the previous route's candidates; a cosmetic path change does not.
    if (social) {
      const nextSocial = socialPageContextStore.get(this.activeTabId);
      if (
        previousSocial?.canonicalContentId &&
        nextSocial?.canonicalContentId &&
        previousSocial.canonicalContentId !== nextSocial.canonicalContentId
      ) {
        useMediaDetectionStore.getState().clearPageDetections();
        mediaDetectionPipeline.reset();
      }
    } else if (previousGeneral) {
      const nextGeneral = generalPageMediaContextStore.get(this.activeTabId);
      if (nextGeneral && nextGeneral.pageGeneration !== previousGeneral.pageGeneration) {
        useMediaDetectionStore.getState().clearPageDetections();
        mediaDetectionPipeline.reset();
      }
    }
    return true;
  }

  private isCurrentEpoch(epoch: number): boolean {
    return epoch === this.navigationEpoch;
  }
}

type NativeObservationInput = {
  tabId?: string;
  navigationEpoch?: number;
  observedAt?: number;
  frameUrl?: string | null;
  url: string;
  mimeType?: string | null;
  requiresCookies?: boolean;
  pageUrl?: string;
  hasRange?: boolean;
  isForMainFrame?: boolean;
  resourceFingerprint?: string | null;
  observationSource?: string | null;
};

type DeferredEntry = { kind: 'native'; native: NativeObservationInput } | { kind: 'page'; raw: string };
type DeferredObservation = DeferredEntry & { at: number };

type TabDetectionSnapshot = {
  pageUrl: string;
  navigationEpoch: number;
  detectedMedia: MediaDetectionState['detectedMedia'];
  qualities: MediaDetectionState['qualities'];
  pageMetadata: MediaDetectionState['pageMetadata'];
};

const MAX_TAB_SNAPSHOTS = 6;
const MAX_DEFERRED = 32;
const DEFERRED_TTL_MS = 15_000;

/**
 * Same page for detection: the same page identity (host, path and content-selecting query), or — on an ordinary
 * website — the same public content (a video id carried in the path or `v`/`video` parameter).
 */
function isSamePageContent(a: string, b: string): boolean {
  if (isSameDocumentUrl(a, b)) {
    return true;
  }
  if (resolveSocialPlatform(a) || resolveSocialPlatform(b)) {
    return false;
  }
  return isSameGeneralContentNavigation(a, b);
}

function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function pageUrlOfMessage(message: ParsedBridgeMessage): string | null {
  const payload = (message as { payload?: { pageUrl?: unknown } }).payload;
  return payload && typeof payload.pageUrl === 'string' && payload.pageUrl ? payload.pageUrl : null;
}

/** Init segments, media fragments and playlist segments — never a standalone downloadable file. */
function isSegmentOrFragmentUrl(url: string): boolean {
  return isLikelyMediaSegment(url) || isInitOrFragmentMediaPath(url);
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Same-origin SPA route change (path/query) without requiring social hosts. */
function isSameOriginSpaTransition(fromUrl: string, toUrl: string): boolean {
  try {
    const a = new URL(fromUrl);
    const b = new URL(toUrl);
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

export const mediaDetectionEngine = new MediaDetectionEngine();
